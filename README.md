# Print-Ready Artwork Checker

A browser tool that inspects an artwork PDF and reports whether it is set up for
the chosen finishing method:

- **Trim square** — checks for a `TrimBox`, at least **5 mm bleed**, and crop marks.
- **Die-cut / profile cut** — checks for at least one **spot colour** and that the
  spot colour is painted with **overprint** turned on. When either is missing it
  shows a short Illustrator / Affinity guide for creating a spot colour and
  applying overprint.

Everything runs client-side. The PDF is never uploaded anywhere.

## Running it

ES modules don't load from `file://`, so serve the folder over HTTP:

```sh
./serve.sh          # http://localhost:8000
./serve.sh 3000     # pick another port
```

Then open the printed URL. `pdf-lib` is loaded from a CDN (jsDelivr) via an
import map — an internet connection is needed the first time.

## How it works

| File | Responsibility |
| --- | --- |
| `js/preflight.js` | Loads the PDF, runs the checks for the chosen mode, builds the result |
| `js/pdf/boxes.js` | Reads and compares MediaBox / CropBox / TrimBox / BleedBox / ArtBox |
| `js/pdf/colors.js` | Walks the object graph for `Separation` / `DeviceN` colour spaces |
| `js/pdf/overprint.js` | Finds `ExtGState` dictionaries that switch overprint on |
| `js/pdf/content.js` | Mini content-stream interpreter: is a spot colour painted with overprint on? are there crop-mark strokes outside the TrimBox? |
| `js/tutorials.js` | The Illustrator / Affinity how-to content |
| `js/main.js` | UI wiring and rendering |

### Check logic

**Trim square**

1. *TrimBox defined* — every page must have a `TrimBox` key. Fails if any page
   lacks one.
2. *5 mm bleed* — measures the inset from `BleedBox` to `TrimBox` on all four
   sides. `< 5 mm` (minus a 0.3 mm tolerance) fails. If there is no `BleedBox`
   but the `MediaBox` gives ≥ 5 mm, it warns instead of failing.
3. *Trim / crop marks* — the content scan looks for thin, short stroked/filled
   paths sitting just outside the `TrimBox` near each corner. 3–4 corners pass;
   1–2 warn. If none are found but the page is big enough to hold them, it warns;
   if the page is barely bigger than the `TrimBox`, it fails.

**Die-cut / profile cut**

1. *Spot colour present* — pass if a named `Separation` / `DeviceN` spot exists;
   warn if the only separation is a registration / all-plates colour; fail if the
   file is process-only.
2. *Overprint on the spot colour* — the content interpreter tracks the current
   colour space and the current `OP` / `op` overprint flags. Pass if the spot
   colour is actually painted while overprint is on; fail if it is painted with
   overprint off. If the content can't be fully parsed it falls back to checking
   the file structure and warns.

## Known limitations

- The checks are structural. The tool does **not** render the artwork, so it
  cannot confirm that image data actually fills the bleed, or visually verify a
  knockout. Always proof in Overprint Preview as well.
- Crop marks drawn as a single combined path (rather than one stroke per mark)
  may not be detected; the check then falls back to the page-size heuristic.
- Page `/Rotate` and `/UserUnit` are ignored in the crop-mark geometry.
- Encrypted / password-protected PDFs are flagged and may give unreliable
  results (pdf-lib does not decrypt streams).
- Content streams using a Flate **predictor** (very rare for page content) are
  skipped by the content scan.

## No build step

There is no bundler or package manager here — the project is plain ES modules.
To vendor `pdf-lib` instead of using the CDN, download
`pdf-lib@1.17.1/dist/pdf-lib.esm.min.js` into `js/vendor/` and change the import
map in `index.html`.
