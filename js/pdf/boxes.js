// Reading and comparing the PDF page boxes (MediaBox / CropBox / TrimBox /
// BleedBox / ArtBox).

import { PDFNumber } from 'pdf-lib';
import { PT_TO_MM } from '../config.js';

function rectFromPdfArray(arr) {
  if (!arr || typeof arr.size !== 'function' || arr.size() < 4) return null;
  try {
    const n = (i) => arr.lookup(i, PDFNumber).asNumber();
    const x1 = n(0), y1 = n(1), x2 = n(2), y2 = n(3);
    if ([x1, y1, x2, y2].some((v) => !isFinite(v))) return null;
    return {
      llx: Math.min(x1, x2), lly: Math.min(y1, y2),
      urx: Math.max(x1, x2), ury: Math.max(y1, y2),
    };
  } catch {
    return null;
  }
}

// `PDFPageLeaf` box accessors: MediaBox()/CropBox() are inheritable, while
// TrimBox()/BleedBox()/ArtBox() return undefined when the key is absent, which
// is exactly the "is it set?" signal we want.
export function readPageBoxes(page) {
  const node = page.node;
  const media = rectFromPdfArray(safe(() => node.MediaBox()));
  const crop = rectFromPdfArray(safe(() => node.CropBox()));
  const trim = rectFromPdfArray(safe(() => node.TrimBox()));
  const bleed = rectFromPdfArray(safe(() => node.BleedBox()));
  const art = rectFromPdfArray(safe(() => node.ArtBox()));
  return {
    media, crop, trim, bleed, art,
    hasTrim: !!trim, hasBleed: !!bleed, hasCrop: !!crop, hasArt: !!art,
  };
}

// Margins of `outer` around `inner`, in points. Negative = inner pokes outside.
export function margins(outer, inner) {
  return {
    left: inner.llx - outer.llx,
    bottom: inner.lly - outer.lly,
    right: outer.urx - inner.urx,
    top: outer.ury - inner.ury,
  };
}

export const minMargin = (m) => Math.min(m.left, m.right, m.top, m.bottom);

export function boxSummary(b) {
  if (!b) return null;
  const f = (r) =>
    r ? { w: +((r.urx - r.llx) * PT_TO_MM).toFixed(2), h: +((r.ury - r.lly) * PT_TO_MM).toFixed(2) } : null;
  return {
    media: f(b.media), crop: f(b.crop), trim: f(b.trim), bleed: f(b.bleed), art: f(b.art),
    hasTrim: b.hasTrim, hasBleed: b.hasBleed,
  };
}

function safe(fn) {
  try { return fn(); } catch { return undefined; }
}
