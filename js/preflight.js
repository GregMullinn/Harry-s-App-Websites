// Orchestrates a preflight run: load the PDF, run the checks for the chosen
// finishing method, and return a plain result object for the UI to render.

import { PDFDocument } from 'pdf-lib';
import { readPageBoxes, boxSummary, margins, minMargin } from './pdf/boxes.js';
import { findSpotColors } from './pdf/colors.js';
import { findOverprint } from './pdf/overprint.js';
import { analyzeDocumentContent } from './pdf/content.js';
import { MM_TO_PT, PT_TO_MM, BLEED_MM, BLEED_TOL_MM, MARKS_EXTRA_MM } from './config.js';

export async function runPreflight(arrayBuffer, mode) {
  let doc;
  try {
    doc = await PDFDocument.load(new Uint8Array(arrayBuffer), {
      ignoreEncryption: true,
      throwOnInvalidObject: false,
      updateMetadata: false,
    });
  } catch (e) {
    return { fatal: `Could not read this file as a PDF (${e && e.message ? e.message : 'parse error'}).` };
  }

  const pages = doc.getPages();
  if (!pages.length) return { fatal: 'This PDF has no pages.' };

  const perPage = pages.map(readPageBoxes);
  const content = analyzeDocumentContent(doc);

  const meta = {
    pages: pages.length,
    encrypted: !!doc.isEncrypted,
    producer: safe(() => doc.getProducer()),
    creator: safe(() => doc.getCreator()),
    page1: boxSummary(perPage[0]),
    contentNotes: content.notes.slice(0, 4),
  };

  const checks = [];
  if (doc.isEncrypted) {
    checks.push({
      id: 'encrypted',
      label: 'Encrypted PDF',
      status: 'warn',
      detail: 'This PDF is encrypted, so some structure could not be read reliably. Re-save it without a password and check again.',
    });
  }

  let showTutorials = false;
  if (mode === 'trim') {
    trimChecks(perPage, content, checks);
  } else {
    const spot = findSpotColors(doc);
    const overprint = findOverprint(doc);
    showTutorials = diecutChecks(spot, overprint, content, checks);
    meta.spotColors = spot.all.map((s) => ({
      name: s.name,
      spaces: [...s.spaces],
      isProcess: s.isProcess,
      special: s.special,
    }));
    meta.spotTruncated = spot.truncated;
  }

  const verdict = checks.some((c) => c.status === 'fail')
    ? 'fail'
    : checks.some((c) => c.status === 'warn')
      ? 'warn'
      : 'pass';

  return { fatal: null, mode, meta, checks, verdict, showTutorials };
}

// ---- trim-square checks -------------------------------------------------

function trimChecks(perPage, content, checks) {
  const bleedPt = BLEED_MM * MM_TO_PT;
  const tolPt = BLEED_TOL_MM * MM_TO_PT;

  // 1. TrimBox present
  const missing = perPage.map((b, i) => (b.trim ? null : i + 1)).filter(Boolean);
  if (missing.length === 0) {
    checks.push({
      id: 'trimbox',
      label: 'TrimBox defined',
      status: 'pass',
      detail: 'Every page has a TrimBox, so the final cut size is unambiguous.',
    });
  } else {
    checks.push({
      id: 'trimbox',
      label: 'TrimBox defined',
      status: 'fail',
      detail:
        `No TrimBox on page(s) ${missing.join(', ')}. The cut line is only implied by the page edge. ` +
        'Export from Illustrator/InDesign with "Trim Marks" and "Use Document Bleed Settings" on, or from Affinity as a press-ready PDF with crop marks.',
    });
  }

  // 2. 5 mm bleed
  let worst = Infinity;
  let anyFail = false;
  let anyWarnNoBox = false;
  const details = [];
  perPage.forEach((b, i) => {
    if (!b.trim) return;
    let m;
    let from;
    if (b.bleed) { m = minMargin(margins(b.bleed, b.trim)); from = 'BleedBox'; }
    else if (b.media) { m = minMargin(margins(b.media, b.trim)); from = 'MediaBox (no BleedBox set)'; }
    else { m = -Infinity; from = 'nothing'; }
    worst = Math.min(worst, m);
    const mm = m === -Infinity ? 0 : m * PT_TO_MM;
    if (m + tolPt < bleedPt) {
      anyFail = true;
      details.push(`page ${i + 1}: ${mm.toFixed(2)} mm from ${from}`);
    } else if (!b.bleed) {
      anyWarnNoBox = true;
      details.push(`page ${i + 1}: ${mm.toFixed(2)} mm, but measured from the MediaBox`);
    }
  });

  if (worst === Infinity) {
    checks.push({
      id: 'bleed',
      label: `${BLEED_MM} mm bleed`,
      status: 'fail',
      detail: 'Could not measure bleed because no page has a TrimBox.',
    });
  } else if (anyFail) {
    checks.push({
      id: 'bleed',
      label: `${BLEED_MM} mm bleed`,
      status: 'fail',
      detail:
        `Bleed is under ${BLEED_MM} mm somewhere (${details.join('; ')}). ` +
        `Set document bleed to ${BLEED_MM} mm on all four sides and re-export.`,
    });
  } else if (anyWarnNoBox) {
    checks.push({
      id: 'bleed',
      label: `${BLEED_MM} mm bleed`,
      status: 'warn',
      detail:
        `There is at least ${(worst * PT_TO_MM).toFixed(2)} mm around the trim, but no BleedBox is defined, ` +
        `so some RIPs will ignore it. Re-export with a ${BLEED_MM} mm bleed box (${details.join('; ')}).`,
    });
  } else {
    checks.push({
      id: 'bleed',
      label: `${BLEED_MM} mm bleed`,
      status: 'pass',
      detail:
        `The BleedBox gives at least ${(worst * PT_TO_MM).toFixed(2)} mm of bleed on every page. ` +
        'This checks the box geometry only — confirm visually that the artwork actually fills the bleed.',
    });
  }

  // 3. Trim / crop marks
  const corners = content.cropMarkCorners;
  const marksRoomPt = (BLEED_MM + MARKS_EXTRA_MM) * MM_TO_PT;
  const roomEveryPage = perPage.every(
    (b) => b.trim && b.media && minMargin(margins(b.media, b.trim)) + tolPt >= marksRoomPt,
  );

  if (corners.size >= 3) {
    checks.push({
      id: 'marks',
      label: 'Trim / crop marks',
      status: 'pass',
      detail: `Crop-mark lines detected just outside the TrimBox at ${corners.size} of 4 corners.`,
    });
  } else if (corners.size >= 1) {
    checks.push({
      id: 'marks',
      label: 'Trim / crop marks',
      status: 'warn',
      detail:
        `Mark-like lines found at only ${corners.size} corner(s). ` +
        'If your workflow needs printed crop marks, re-export with marks at all four corners.',
    });
  } else if (roomEveryPage) {
    checks.push({
      id: 'marks',
      label: 'Trim / crop marks',
      status: 'warn',
      detail:
        'No crop marks found in the artwork. The page is big enough to hold them ' +
        `(TrimBox + ${(BLEED_MM + MARKS_EXTRA_MM).toFixed(1)} mm). If your printer generates marks from the TrimBox ` +
        'you may not need them; otherwise re-export with trim marks on.',
    });
  } else {
    checks.push({
      id: 'marks',
      label: 'Trim / crop marks',
      status: 'warn',
      detail:
        'No crop marks found, and the page is barely larger than the TrimBox so there is little room to add them. ' +
        `If your printer needs printed marks, enlarge the artboard/page to leave ${BLEED_MM} mm bleed plus a few mm ` +
        'for marks and re-export with trim marks on.',
    });
  }

  if (!content.ok) {
    checks.push({
      id: 'content-note',
      label: 'Content analysis',
      status: 'info',
      detail:
        `Some page content could not be fully parsed (${content.notes.slice(0, 3).join('; ') || 'unknown'}), ` +
        'so the crop-mark check may be incomplete. The box checks above are unaffected.',
    });
  }
}

// ---- die-cut / profile-cut checks ------------------------------------------

function diecutChecks(spot, overprint, content, checks) {
  let showTut = false;
  const hasSpot = spot.hasSpot;

  // 1. spot colour present
  if (spot.hasNamedSpot) {
    const names = spot.spots
      .filter((s) => s.special !== 'all')
      .map((s) => `${s.name} (${s.spaces.join('/')})`);
    checks.push({
      id: 'spot',
      label: 'Spot colour present',
      status: 'pass',
      detail: `Found named spot separation(s): ${names.join(', ')}. Use one of these for the cutter / die line.`,
    });
  } else if (hasSpot) {
    checks.push({
      id: 'spot',
      label: 'Spot colour present',
      status: 'warn',
      detail:
        'The only separation in the file is a registration / all-plates colour. That is normally used for ' +
        'printer’s marks, not a cut path. Draw the die line in its own named spot colour (e.g. CutContour). See the guide below.',
    });
    showTut = true;
  } else {
    checks.push({
      id: 'spot',
      label: 'Spot colour present',
      status: 'fail',
      detail:
        'No spot (Separation / DeviceN) colour in the file — only process inks. A die-cut / profile-cut ' +
        'file needs the cut path drawn in a named spot colour. See the guide below.',
    });
    showTut = true;
  }
  if (spot.truncated) {
    checks.push({
      id: 'spot-note',
      label: 'Colour scan',
      status: 'info',
      detail: 'This file is very large; the colour-space scan stopped early, so a spot colour may exist that is not listed.',
    });
  }

  // 2. overprint on the spot colour
  const spotPaintedOP = content.ok && (content.spotStrokedOverprint || content.spotFilledOverprint);
  const spotPaintedNoOP =
    content.ok && !spotPaintedOP &&
    (content.spotStroked || content.spotFilled ||
      content.spotStrokedNoOverprint || content.spotFilledNoOverprint);

  if (!hasSpot) {
    checks.push({
      id: 'overprint',
      label: 'Overprint on the spot colour',
      status: 'fail',
      detail: 'There is no spot colour to overprint. Add one first (guide below), then set it to overprint.',
    });
    showTut = true;
  } else if (spotPaintedOP) {
    checks.push({
      id: 'overprint',
      label: 'Overprint on the spot colour',
      status: 'pass',
      detail:
        'The spot colour is painted with overprint turned on, so the cut path will not knock a hole ' +
        'in the artwork beneath it.',
    });
  } else if (spotPaintedNoOP) {
    checks.push({
      id: 'overprint',
      label: 'Overprint on the spot colour',
      status: 'fail',
      detail:
        'The spot colour is used, but overprint is not applied where it is painted. Turn on ' +
        'Overprint Stroke (or Overprint Fill) for the cut path. See the guide below.',
    });
    showTut = true;
  } else if (overprint.hasOverprintState && overprint.referencedByPage) {
    checks.push({
      id: 'overprint',
      label: 'Overprint on the spot colour',
      status: 'warn',
      detail:
        'An overprint graphics state exists and is referenced on a page, but the content scan could not ' +
        'confirm it is applied to the spot colour. Check View ▸ Overprint Preview; if the cut path ' +
        'knocks out, follow the guide below.',
    });
    showTut = true;
  } else if (overprint.hasOverprintState) {
    checks.push({
      id: 'overprint',
      label: 'Overprint on the spot colour',
      status: 'warn',
      detail:
        'An overprint setting exists in the file but does not appear to be used on a page. Confirm the ' +
        'cut path itself is set to overprint (guide below).',
    });
    showTut = true;
  } else {
    checks.push({
      id: 'overprint',
      label: 'Overprint on the spot colour',
      status: 'fail',
      detail:
        'No overprint setting found anywhere in the file. The spot cut path needs Overprint Stroke / Fill ' +
        'enabled. See the guide below.',
    });
    showTut = true;
  }

  if (!content.ok) {
    checks.push({
      id: 'content-note',
      label: 'Content analysis',
      status: 'info',
      detail:
        `Some page content could not be fully parsed (${content.notes.slice(0, 3).join('; ') || 'unknown'}). ` +
        'The overprint result was inferred from the file structure instead — verify in Overprint Preview.',
    });
  }

  return showTut;
}

function safe(fn) {
  try {
    const v = fn();
    return v == null || v === '' ? null : v;
  } catch {
    return null;
  }
}
