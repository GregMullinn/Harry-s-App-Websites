// A small PDF content-stream interpreter. It does not draw anything; it tracks
// just enough graphics state to answer two questions:
//
//   1. Is a spot colour actually painted, and is overprint on when it is?
//   2. Are there crop-mark-like strokes just outside the TrimBox at the corners?
//
// It walks page content streams and recurses into Form XObjects.

import {
  PDFName, PDFNumber, PDFRawStream, PDFArray, PDFDict, PDFRef, decodePDFRawStream,
} from 'pdf-lib';
import {
  PROCESS_COLORANTS, MM_TO_PT, LINE_THINNESS_PT, CORNER_ZONE_MM,
  MAX_FORM_DEPTH, MAX_CONTENT_BYTES, OP_BUDGET,
} from '../config.js';
import { readPageBoxes } from './boxes.js';
import { gsOverprint } from './overprint.js';

const WS = new Set([' ', '\t', '\r', '\n', '\f', '\0']);
const DELIM = new Set(['(', ')', '<', '>', '[', ']', '{', '}', '/', '%']);
const isWS = (c) => WS.has(c);
const isDelim = (c) => DELIM.has(c);

function newResult() {
  return {
    ok: true,
    spotStroked: false,
    spotFilled: false,
    spotStrokedOverprint: false,
    spotFilledOverprint: false,
    spotStrokedNoOverprint: false,
    spotFilledNoOverprint: false,
    cropMarkCorners: new Set(),
    notes: [],
    ops: 0,
  };
}

export function analyzeDocumentContent(doc) {
  const ctx = doc.context;
  const out = newResult();
  const pages = doc.getPages();

  for (let p = 0; p < pages.length; p++) {
    const page = pages[p];
    try {
      const node = page.node;
      const Contents = safeCall(() => node.Contents());
      const Resources = safeCall(() => node.Resources());
      const boxes = readPageBoxes(page);
      const bytes = collectContentBytes(Contents);
      if (!bytes.length) continue;
      if (bytes.length > MAX_CONTENT_BYTES) {
        out.ok = false;
        out.notes.push(`page ${p + 1}: content too large to analyse`);
        continue;
      }
      const state = {
        ctm: [1, 0, 0, 1, 0, 0],
        fillSpot: false, strokeSpot: false,
        fillOP: false, strokeOP: false,
      };
      const opts = { depth: 0, trim: boxes.trim, media: boxes.media };
      analyzeStream(bytes, Resources, ctx, opts, state, out);
    } catch (e) {
      out.ok = false;
      out.notes.push(`page ${p + 1}: ${e && e.message ? e.message : 'analysis failed'}`);
    }
  }
  return out;
}

function safeCall(fn) {
  try { return fn(); } catch { return undefined; }
}

function collectContentBytes(Contents) {
  if (!Contents) return new Uint8Array(0);
  const parts = [];
  if (typeof Contents.size === 'function') {
    for (let i = 0; i < Contents.size(); i++) {
      try {
        parts.push(decodeStreamBytes(Contents.lookup(i)));
        parts.push(Uint8Array.of(10));
      } catch { /* skip a bad stream */ }
    }
  } else {
    parts.push(decodeStreamBytes(Contents));
  }
  return concatBytes(parts);
}

function decodeStreamBytes(stream) {
  if (!stream) return new Uint8Array(0);
  if (stream instanceof PDFRawStream) return decodePDFRawStream(stream).decode();
  if (typeof stream.getUnencodedContents === 'function') return stream.getUnencodedContents();
  if (stream.contents) return stream.contents;
  return new Uint8Array(0);
}

function concatBytes(list) {
  let total = 0;
  for (const a of list) total += a.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const a of list) { out.set(a, o); o += a.length; }
  return out;
}

function latin1(bytes) {
  let out = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(bytes.length, i + CH)));
  }
  return out;
}

// Row-vector matrix composition: apply(p, compose(A, B)) === apply(apply(p, A), B)
function compose(A, B) {
  return [
    A[0] * B[0] + A[1] * B[2],
    A[0] * B[1] + A[1] * B[3],
    A[2] * B[0] + A[3] * B[2],
    A[2] * B[1] + A[3] * B[3],
    A[4] * B[0] + A[5] * B[2] + B[4],
    A[4] * B[1] + A[5] * B[3] + B[5],
  ];
}

const cloneGS = (g) => ({
  ctm: g.ctm.slice(),
  fillSpot: g.fillSpot, strokeSpot: g.strokeSpot,
  fillOP: g.fillOP, strokeOP: g.strokeOP,
});

// ---- resource maps -------------------------------------------------------

function buildResourceMaps(res, ctx) {
  const csSpot = new Map(); // name -> bool
  const gs = new Map();     // name -> { OP, op }
  const xobj = new Map();   // name -> stream
  if (!res || typeof res.lookup !== 'function') return { csSpot, gs, xobj };

  const sub = (key) => {
    try {
      const s = res.lookup(PDFName.of(key));
      return s && typeof s.entries === 'function' ? s : null;
    } catch { return null; }
  };

  const csDict = sub('ColorSpace');
  if (csDict) {
    for (const [k, v] of csDict.entries()) {
      csSpot.set(k.decodeText(), colorSpaceIsSpot(v, ctx));
    }
  }
  const gsDict = sub('ExtGState');
  if (gsDict) {
    for (const [k, v] of gsDict.entries()) {
      let d = null;
      try { d = v instanceof PDFRef ? ctx.lookup(v) : v; } catch { /* ignore */ }
      gs.set(k.decodeText(), d instanceof PDFDict ? gsOverprint(d) : {});
    }
  }
  const xoDict = sub('XObject');
  if (xoDict) {
    for (const [k, v] of xoDict.entries()) {
      let d = null;
      try { d = v instanceof PDFRef ? ctx.lookup(v) : v; } catch { /* ignore */ }
      xobj.set(k.decodeText(), d || null);
    }
  }
  return { csSpot, gs, xobj };
}

function colorSpaceIsSpot(obj, ctx, depth = 0) {
  if (depth > 6) return false;
  let o = obj;
  try { if (o instanceof PDFRef) o = ctx.lookup(o); } catch { return false; }
  if (!(o instanceof PDFArray) || o.size() < 1) return false;

  let head = null;
  try { head = o.lookup(0); } catch { /* ignore */ }
  const h = head instanceof PDFName ? head.decodeText() : null;

  if (h === 'Separation') {
    let cn = null;
    try { cn = o.lookup(1); } catch { /* ignore */ }
    const nm = cn instanceof PDFName ? cn.decodeText().trim().toLowerCase() : '';
    return nm !== '' && nm !== 'none' && !PROCESS_COLORANTS.has(nm);
  }
  if (h === 'DeviceN') {
    let names = null;
    try { names = o.lookup(1); } catch { /* ignore */ }
    if (names instanceof PDFArray) {
      for (let i = 0; i < names.size(); i++) {
        let cn = null;
        try { cn = names.lookup(i); } catch { /* ignore */ }
        const nm = cn instanceof PDFName ? cn.decodeText().trim().toLowerCase() : '';
        if (nm && nm !== 'none' && !PROCESS_COLORANTS.has(nm)) return true;
      }
    }
    return false;
  }
  if (h === 'Indexed') {
    let base = null;
    try { base = o.lookup(1); } catch { /* ignore */ }
    return colorSpaceIsSpot(base, ctx, depth + 1);
  }
  if (h === 'Pattern' && o.size() >= 2) {
    let under = null;
    try { under = o.lookup(1); } catch { /* ignore */ }
    return colorSpaceIsSpot(under, ctx, depth + 1);
  }
  return false;
}

// ---- the interpreter ---------------------------------------------------

function analyzeStream(bytes, res, ctx, opts, initialState, out) {
  const s = latin1(bytes);
  const N = s.length;
  const maps = buildResourceMaps(res, ctx);

  const operands = [];
  const gstack = [];
  let gs = initialState;
  let pathBBox = null;

  const pushPt = (x, y) => {
    const m = gs.ctm;
    const dx = m[0] * x + m[2] * y + m[4];
    const dy = m[1] * x + m[3] * y + m[5];
    if (!pathBBox) {
      pathBBox = { minx: dx, miny: dy, maxx: dx, maxy: dy };
    } else {
      if (dx < pathBBox.minx) pathBBox.minx = dx;
      if (dx > pathBBox.maxx) pathBBox.maxx = dx;
      if (dy < pathBBox.miny) pathBBox.miny = dy;
      if (dy > pathBBox.maxy) pathBBox.maxy = dy;
    }
  };

  const lastName = () => {
    for (let k = operands.length - 1; k >= 0; k--) {
      if (operands[k] && operands[k].name != null) return operands[k].name;
    }
    return null;
  };

  const resolveCS = (name) => {
    if (!name) return false;
    if (name === 'DeviceRGB' || name === 'DeviceGray' || name === 'DeviceCMYK' || name === 'Pattern') {
      return false;
    }
    return maps.csSpot.has(name) ? maps.csSpot.get(name) : false;
  };

  const applyGS = (name) => {
    if (!name) return;
    const g = maps.gs.get(name);
    if (!g) return;
    if (g.OP !== undefined) {
      gs.strokeOP = g.OP;
      if (g.op === undefined) gs.fillOP = g.OP; // OP also covers fill when op is absent
    }
    if (g.op !== undefined) gs.fillOP = g.op;
  };

  const paint = (isFill, isStroke) => {
    if (isFill && gs.fillSpot) {
      out.spotFilled = true;
      if (gs.fillOP) out.spotFilledOverprint = true;
      else out.spotFilledNoOverprint = true;
    }
    if (isStroke && gs.strokeSpot) {
      out.spotStroked = true;
      if (gs.strokeOP) out.spotStrokedOverprint = true;
      else out.spotStrokedNoOverprint = true;
    }
    if (pathBBox && opts.trim && opts.media) {
      const corner = classifyMark(pathBBox, opts.trim, opts.media);
      if (corner) out.cropMarkCorners.add(corner);
    }
    pathBBox = null;
  };

  const doXObject = (name) => {
    if (!name || opts.depth >= MAX_FORM_DEPTH) return;
    const xo = maps.xobj.get(name);
    const d = xo && xo.dict ? xo.dict : null;
    if (!d) return;
    let subtype = null;
    try {
      const st = d.lookup(PDFName.of('Subtype'));
      subtype = st && st.decodeText ? st.decodeText() : null;
    } catch { /* ignore */ }
    if (subtype !== 'Form') return;

    let fbytes;
    try { fbytes = decodeStreamBytes(xo); } catch { return; }
    if (!fbytes || !fbytes.length) return;

    let matrix = [1, 0, 0, 1, 0, 0];
    try {
      const ma = d.lookup(PDFName.of('Matrix'));
      if (ma instanceof PDFArray && ma.size() === 6) {
        matrix = [0, 1, 2, 3, 4, 5].map((k) => ma.lookup(k, PDFNumber).asNumber());
      }
    } catch { /* ignore */ }

    let fres = null;
    try { fres = d.lookup(PDFName.of('Resources')); } catch { /* ignore */ }
    if (!fres || typeof fres.entries !== 'function') fres = res;

    const child = cloneGS(gs);
    child.ctm = compose(matrix, gs.ctm);
    analyzeStream(fbytes, fres, ctx, { ...opts, depth: opts.depth + 1 }, child, out);
  };

  const dispatch = (w) => {
    if (++out.ops > OP_BUDGET) throw new Error('operator budget exceeded');
    const L = operands.length;
    const n = (k) => (typeof operands[L - k] === 'number' ? operands[L - k] : 0);

    switch (w) {
      case 'q': gstack.push(cloneGS(gs)); break;
      case 'Q': if (gstack.length) gs = gstack.pop(); break;
      case 'cm': gs.ctm = compose([n(6), n(5), n(4), n(3), n(2), n(1)], gs.ctm); break;

      case 'cs': gs.fillSpot = resolveCS(lastName()); break;
      case 'CS': gs.strokeSpot = resolveCS(lastName()); break;
      case 'g': case 'rg': case 'k': gs.fillSpot = false; break;
      case 'G': case 'RG': case 'K': gs.strokeSpot = false; break;
      case 'gs': applyGS(lastName()); break;

      case 'm': case 'l': pushPt(n(2), n(1)); break;
      case 'c': pushPt(n(6), n(5)); pushPt(n(4), n(3)); pushPt(n(2), n(1)); break;
      case 'v': case 'y': pushPt(n(4), n(3)); pushPt(n(2), n(1)); break;
      case 're': {
        const x = n(4), y = n(3), rw = n(2), rh = n(1);
        pushPt(x, y); pushPt(x + rw, y); pushPt(x + rw, y + rh); pushPt(x, y + rh);
        break;
      }

      case 'S': case 's': paint(false, true); break;
      case 'f': case 'F': case 'f*': paint(true, false); break;
      case 'B': case 'B*': case 'b': case 'b*': paint(true, true); break;
      case 'n': pathBBox = null; break;

      case 'Do': doXObject(lastName()); break;
      default: break; // every other operator just consumes its operands
    }
  };

  let i = 0;
  while (i < N) {
    const c = s[i];
    if (isWS(c)) { i++; continue; }
    if (c === '%') { while (i < N && s[i] !== '\n' && s[i] !== '\r') i++; continue; }
    if (c === '/') { const r = readName(s, i); operands.push({ name: r[0] }); i = r[1]; continue; }
    if (c === '(') { i = skipLiteralString(s, i); operands.push(null); continue; }
    if (c === '<') {
      if (s[i + 1] === '<') { i = skipDict(s, i); } else { i = skipHexString(s, i); }
      operands.push(null);
      continue;
    }
    if (c === '[') { i = skipArray(s, i); operands.push(null); continue; }
    if (c === ']' || c === '>' || c === '}' || c === '{' || c === ')') { i++; continue; }
    if ((c >= '0' && c <= '9') || c === '+' || c === '-' || c === '.') {
      const r = readNumber(s, i);
      if (r) { operands.push(r[0]); i = r[1]; continue; }
      i++;
      continue;
    }
    const w = readWord(s, i);
    i = w[1];
    if (w[0] === '') { i++; continue; }
    if (w[0] === 'BI') { i = skipInlineImage(s, i); operands.length = 0; continue; }
    dispatch(w[0]);
    operands.length = 0;
  }
}

// ---- crop-mark classifier -------------------------------------------------

function classifyMark(bb, trim, media) {
  const w = bb.maxx - bb.minx;
  const h = bb.maxy - bb.miny;
  const thin = Math.min(w, h) <= LINE_THINNESS_PT;
  const long = Math.max(w, h);
  if (!thin || long < 2 || long > 30 * MM_TO_PT) return null;

  const outsideTrim =
    bb.maxx <= trim.llx + 1 || bb.minx >= trim.urx - 1 ||
    bb.maxy <= trim.lly + 1 || bb.miny >= trim.ury - 1;
  const insideMedia =
    bb.minx >= media.llx - 2 && bb.maxx <= media.urx + 2 &&
    bb.miny >= media.lly - 2 && bb.maxy <= media.ury + 2;
  if (!outsideTrim || !insideMedia) return null;

  const zone = CORNER_ZONE_MM * MM_TO_PT;
  const cx = (bb.minx + bb.maxx) / 2;
  const cy = (bb.miny + bb.maxy) / 2;
  const nearX = Math.min(Math.abs(cx - trim.llx), Math.abs(cx - trim.urx)) <= zone;
  const nearY = Math.min(Math.abs(cy - trim.lly), Math.abs(cy - trim.ury)) <= zone;
  if (!nearX || !nearY) return null;

  const midX = (trim.llx + trim.urx) / 2;
  const midY = (trim.lly + trim.ury) / 2;
  return (cy <= midY ? 'b' : 't') + (cx <= midX ? 'l' : 'r');
}

// ---- tokeniser primitives ----------------------------------------------

function readName(s, i) {
  i++; // skip '/'
  let name = '';
  while (i < s.length) {
    const c = s[i];
    if (isWS(c) || isDelim(c)) break;
    if (c === '#' && /^[0-9A-Fa-f]{2}$/.test(s.substr(i + 1, 2))) {
      name += String.fromCharCode(parseInt(s.substr(i + 1, 2), 16));
      i += 3;
      continue;
    }
    name += c;
    i++;
  }
  return [name, i];
}

function readNumber(s, i) {
  let j = i;
  if (s[j] === '+' || s[j] === '-') j++;
  let seen = false;
  while (j < s.length && ((s[j] >= '0' && s[j] <= '9') || s[j] === '.')) { j++; seen = true; }
  if (!seen) return null;
  const val = parseFloat(s.slice(i, j));
  return [isFinite(val) ? val : 0, j];
}

function readWord(s, i) {
  let j = i;
  while (j < s.length && !isWS(s[j]) && !isDelim(s[j])) j++;
  return [s.slice(i, j), j];
}

function skipLiteralString(s, i) {
  let depth = 0;
  let j = i;
  while (j < s.length) {
    const c = s[j];
    if (c === '\\') { j += 2; continue; }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return j + 1; }
    j++;
  }
  return j;
}

function skipHexString(s, i) {
  const j = s.indexOf('>', i);
  return j < 0 ? s.length : j + 1;
}

function skipDict(s, i) {
  let j = i + 2;
  let depth = 1;
  while (j < s.length && depth > 0) {
    if (s[j] === '<' && s[j + 1] === '<') { depth++; j += 2; continue; }
    if (s[j] === '>' && s[j + 1] === '>') { depth--; j += 2; continue; }
    if (s[j] === '(') { j = skipLiteralString(s, j); continue; }
    if (s[j] === '<') { j = skipHexString(s, j); continue; }
    j++;
  }
  return j;
}

function skipArray(s, i) {
  let j = i + 1;
  let depth = 1;
  while (j < s.length && depth > 0) {
    const c = s[j];
    if (c === '[') { depth++; j++; continue; }
    if (c === ']') { depth--; j++; continue; }
    if (c === '(') { j = skipLiteralString(s, j); continue; }
    if (c === '<') { j = s[j + 1] === '<' ? skipDict(s, j) : skipHexString(s, j); continue; }
    j++;
  }
  return j;
}

function findWordToken(s, from, word) {
  let idx = from;
  for (;;) {
    idx = s.indexOf(word, idx);
    if (idx < 0) return -1;
    const before = idx === 0 ? ' ' : s[idx - 1];
    const after = idx + word.length >= s.length ? ' ' : s[idx + word.length];
    if ((isWS(before) || isDelim(before)) && (isWS(after) || isDelim(after))) return idx;
    idx += word.length;
  }
}

function skipInlineImage(s, i) {
  const idIdx = findWordToken(s, i, 'ID');
  if (idIdx < 0) return s.length;
  let k = idIdx + 3; // past "ID" + one whitespace byte
  while (k < s.length) {
    if (
      s[k] === 'E' && s[k + 1] === 'I' &&
      (k === 0 || isWS(s[k - 1])) &&
      (k + 2 >= s.length || isWS(s[k + 2]) || isDelim(s[k + 2]))
    ) {
      return k + 2;
    }
    k++;
  }
  return s.length;
}
