// Find spot colours by walking the whole indirect-object graph looking for
// Separation and DeviceN colour spaces.

import { PDFName, PDFArray, PDFDict, PDFRef, PDFStream } from 'pdf-lib';
import { PROCESS_COLORANTS, WALK_BUDGET } from '../config.js';

const nameText = (obj) => (obj instanceof PDFName ? obj.decodeText() : null);

export function findSpotColors(doc) {
  const ctx = doc.context;
  const found = new Map(); // colorant name -> { name, spaces:Set, isProcess, special }
  const seenRefs = new Set();
  let budget = WALK_BUDGET;
  let truncated = false;

  const record = (name, spaceType) => {
    if (name == null || name === '') return;
    let e = found.get(name);
    if (!e) {
      const low = name.trim().toLowerCase();
      e = {
        name,
        spaces: new Set(),
        isProcess: PROCESS_COLORANTS.has(low),
        special: low === 'none' ? 'none' : low === 'all' ? 'all' : null,
      };
      found.set(name, e);
    }
    e.spaces.add(spaceType);
  };

  const inspectArray = (arr) => {
    let head = null;
    try { head = arr.lookup(0); } catch { /* ignore */ }
    const h = nameText(head);
    if (h === 'Separation') {
      let colorant = null;
      try { colorant = nameText(arr.lookup(1)); } catch { /* ignore */ }
      record(colorant, 'Separation');
    } else if (h === 'DeviceN') {
      let names = null;
      try { names = arr.lookup(1); } catch { /* ignore */ }
      if (names instanceof PDFArray) {
        for (let i = 0; i < names.size(); i++) {
          let cn = null;
          try { cn = nameText(names.lookup(i)); } catch { /* ignore */ }
          record(cn, 'DeviceN');
        }
      }
    }
  };

  const walk = (obj) => {
    if (obj == null || budget-- <= 0) {
      if (budget <= 0) truncated = true;
      return;
    }
    if (obj instanceof PDFRef) {
      const key = `${obj.objectNumber} ${obj.generationNumber}`;
      if (seenRefs.has(key)) return;
      seenRefs.add(key);
      let resolved = null;
      try { resolved = ctx.lookup(obj); } catch { /* ignore */ }
      return walk(resolved);
    }
    if (obj instanceof PDFArray) {
      inspectArray(obj);
      for (let i = 0; i < obj.size(); i++) {
        let el = null;
        try { el = obj.get(i); } catch { /* ignore */ }
        walk(el);
      }
      return;
    }
    if (obj instanceof PDFDict || obj instanceof PDFStream) {
      const d = obj instanceof PDFStream ? obj.dict : obj;
      let entries = [];
      try { entries = d.entries(); } catch { /* ignore */ }
      for (const [, v] of entries) walk(v);
    }
  };

  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    seenRefs.add(`${ref.objectNumber} ${ref.generationNumber}`);
    walk(obj);
    if (truncated) break;
  }

  const all = [...found.values()].map((e) => ({ ...e, spaces: [...e.spaces] }));
  const spots = all.filter((e) => !e.isProcess && e.special !== 'none');
  return {
    all,
    spots,
    hasSpot: spots.length > 0,
    hasNamedSpot: spots.some((e) => e.special !== 'all'),
    truncated,
  };
}
