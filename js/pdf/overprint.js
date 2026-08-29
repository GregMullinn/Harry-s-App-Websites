// Find ExtGState dictionaries that switch overprint on, and note whether any of
// them are referenced from a page's resource dictionary.

import { PDFName, PDFDict, PDFBool, PDFStream, PDFRef, PDFNumber } from 'pdf-lib';

const GS_KEYS = ['OP', 'op', 'OPM', 'BM', 'SMask', 'ca', 'CA', 'LW', 'D'];

export function gsOverprint(dict) {
  const get = (k) => {
    try { return dict.lookup(PDFName.of(k)); } catch { return undefined; }
  };
  const asBool = (v) => (v instanceof PDFBool ? v.asBoolean() : undefined);
  const OPM = get('OPM');
  return {
    OP: asBool(get('OP')),
    op: asBool(get('op')),
    OPM: OPM instanceof PDFNumber ? OPM.asNumber() : undefined,
  };
}

export function findOverprint(doc) {
  const ctx = doc.context;
  const states = [];

  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    const dict = obj instanceof PDFDict ? obj : obj instanceof PDFStream ? obj.dict : null;
    if (!dict) continue;

    let type = null;
    try {
      const t = dict.lookup(PDFName.of('Type'));
      type = t && t.decodeText ? t.decodeText() : null;
    } catch { /* ignore */ }

    const looksLikeGs =
      type === 'ExtGState' ||
      GS_KEYS.some((k) => {
        try { return !!dict.get(PDFName.of(k)); } catch { return false; }
      });
    if (!looksLikeGs) continue;

    const info = gsOverprint(dict);
    if (info.OP === true || info.op === true) {
      states.push({ key: `${ref.objectNumber} ${ref.generationNumber}`, ...info });
    }
  }

  let referencedByPage = false;
  for (const page of doc.getPages()) {
    let res = null;
    try { res = page.node.Resources(); } catch { /* ignore */ }
    if (!res) continue;
    let egs = null;
    try { egs = res.lookup(PDFName.of('ExtGState')); } catch { /* ignore */ }
    if (!egs || typeof egs.entries !== 'function') continue;
    for (const [, v] of egs.entries()) {
      let gd = null;
      try { gd = v instanceof PDFRef ? ctx.lookup(v) : v; } catch { /* ignore */ }
      if (!(gd instanceof PDFDict)) continue;
      const info = gsOverprint(gd);
      if (info.OP === true || info.op === true) referencedByPage = true;
    }
  }

  return { states, hasOverprintState: states.length > 0, referencedByPage };
}
