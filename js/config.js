// Tunable constants for the preflight checks.

export const MM_TO_PT = 72 / 25.4;        // 1 mm in PDF points (~2.83465)
export const PT_TO_MM = 25.4 / 72;        // 1 point in mm

export const BLEED_MM = 5;                // required bleed on every side
export const BLEED_TOL_MM = 0.3;          // slack so a 4.8 mm export still passes

// Extra room (beyond bleed) the MediaBox must give before we'll say "there is
// space to add crop marks".
export const MARKS_EXTRA_MM = 2.5;

// Crop-mark geometry heuristics (device space, points).
export const LINE_THINNESS_PT = 2.5;      // a stroked path this thin in one axis is a rule/mark
export const CORNER_ZONE_MM = 25;         // a mark must sit this close to a trim corner

// A DeviceN / Separation colorant with one of these names is a process ink,
// not a spot colour.
export const PROCESS_COLORANTS = new Set(['cyan', 'magenta', 'yellow', 'black']);

// Guards against pathological files.
export const MAX_FORM_DEPTH = 6;
export const MAX_CONTENT_BYTES = 48 * 1024 * 1024;
export const OP_BUDGET = 3_000_000;
export const WALK_BUDGET = 800_000;
