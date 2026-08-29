// UI wiring: file selection, mode choice, running the preflight and rendering
// the result. All PDF work happens in ./preflight.js and ./pdf/*.

import { runPreflight } from './preflight.js';
import { TUTORIALS } from './tutorials.js';

const $ = (sel) => document.querySelector(sel);

const dropzone = $('#dropzone');
const fileInput = $('#file-input');
const fileName = $('#file-name');
const fileHint = $('#file-hint');
const runBtn = $('#run');
const toggleGuidesBtn = $('#toggle-guides');
const statusEl = $('#status');
const resultsEl = $('#results');
const guidesEl = $('#guides');

let currentFile = null;

// ---- tutorials ---------------------------------------------------------

$('#tab-illustrator').innerHTML = TUTORIALS.illustrator;
$('#tab-affinity').innerHTML = TUTORIALS.affinity;

guidesEl.querySelectorAll('.tabs button').forEach((btn) => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    guidesEl.querySelectorAll('.tabs button').forEach((b) => {
      const on = b === btn;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    });
    $('#tab-illustrator').hidden = tab !== 'illustrator';
    $('#tab-affinity').hidden = tab !== 'affinity';
  });
});

toggleGuidesBtn.addEventListener('click', () => {
  guidesEl.hidden = !guidesEl.hidden;
  toggleGuidesBtn.textContent = guidesEl.hidden ? 'Show setup guides' : 'Hide setup guides';
});

// ---- file input ------------------------------------------------------

function acceptFile(file) {
  if (!file) return;
  const looksPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!looksPdf) {
    setStatus('That doesn’t look like a PDF.', true);
    return;
  }
  currentFile = file;
  fileName.textContent = file.name;
  fileHint.textContent = `${(file.size / 1024 / 1024).toFixed(1)} MB`;
  setStatus('');
  syncRunButton();
}

dropzone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => acceptFile(fileInput.files[0]));

['dragenter', 'dragover'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.add('drag');
  }),
);
['dragleave', 'drop'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag');
  }),
);
dropzone.addEventListener('drop', (e) => {
  const file = e.dataTransfer?.files?.[0];
  acceptFile(file);
});

document.querySelectorAll('input[name="mode"]').forEach((r) =>
  r.addEventListener('change', syncRunButton),
);

function selectedMode() {
  const r = document.querySelector('input[name="mode"]:checked');
  return r ? r.value : null;
}

function syncRunButton() {
  runBtn.disabled = !(currentFile && selectedMode());
}

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.style.color = isError ? 'var(--fail)' : 'var(--ink-soft)';
}

// ---- run ------------------------------------------------------------

runBtn.addEventListener('click', async () => {
  if (!currentFile || !selectedMode()) return;
  runBtn.disabled = true;
  setStatus('Reading and checking…');
  resultsEl.hidden = true;

  try {
    const buf = await currentFile.arrayBuffer();
    const result = await runPreflight(buf, selectedMode());
    renderResult(result);
    setStatus('');
  } catch (e) {
    setStatus(`Something went wrong: ${e && e.message ? e.message : e}`, true);
  } finally {
    runBtn.disabled = false;
    syncRunButton();
  }
});

// ---- rendering -----------------------------------------------------

function el(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const kid of kids) node.append(kid);
  return node;
}

const VERDICT_TEXT = {
  pass: 'Looks print-ready',
  warn: 'Print-ready with warnings — review below',
  fail: 'Not print-ready — issues found',
};

function renderResult(result) {
  resultsEl.replaceChildren();

  if (result.fatal) {
    resultsEl.append(el('div', { class: 'verdict fail' }, el('span', { class: 'dot', text: '✕' }), el('span', { text: result.fatal })));
    resultsEl.hidden = false;
    return;
  }

  const dot = { pass: '✓', warn: '⚠', fail: '✕' }[result.verdict];
  resultsEl.append(
    el('div', { class: `verdict ${result.verdict}` },
      el('span', { class: 'dot', text: dot }),
      el('span', { text: VERDICT_TEXT[result.verdict] }),
    ),
  );

  const list = el('ul', { class: 'checks' });
  for (const c of result.checks) {
    const item = el('li', { class: 'check' });
    item.append(
      el('div', { class: 'check-head' },
        el('span', { class: `badge ${c.status}`, text: c.status }),
        el('span', { text: c.label }),
      ),
      el('p', { class: 'check-detail', text: c.detail }),
    );
    list.append(item);
  }
  resultsEl.append(list);

  resultsEl.append(renderMeta(result));
  resultsEl.hidden = false;

  // Guides: auto-open when die-cut checks want them.
  if (result.showTutorials) {
    guidesEl.hidden = false;
    toggleGuidesBtn.textContent = 'Hide setup guides';
  }
  toggleGuidesBtn.hidden = false;

  resultsEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderMeta(result) {
  const m = result.meta;
  const wrap = el('details', { class: 'meta' });
  wrap.append(el('summary', { text: 'File details' }));

  const rows = [];
  rows.push(['Pages', String(m.pages)]);
  if (m.producer) rows.push(['Producer', m.producer]);
  if (m.creator) rows.push(['Creator', m.creator]);

  const b = m.page1;
  if (b) {
    const fmt = (r) => (r ? `${r.w} × ${r.h} mm` : '— not set');
    rows.push(['MediaBox (page 1)', fmt(b.media)]);
    rows.push(['TrimBox (page 1)', fmt(b.trim)]);
    rows.push(['BleedBox (page 1)', fmt(b.bleed)]);
  }
  if (m.spotColors && m.spotColors.length) {
    const label = m.spotColors
      .map((s) => `${s.name}${s.isProcess ? ' [process]' : ''} (${s.spaces.join('/')})`)
      .join(', ');
    rows.push(['Separations found', label]);
  } else if (result.mode === 'diecut') {
    rows.push(['Separations found', 'none']);
  }
  if (m.contentNotes && m.contentNotes.length) {
    rows.push(['Content notes', m.contentNotes.join('; ')]);
  }

  const table = el('table');
  for (const [k, v] of rows) {
    const tr = el('tr');
    tr.append(el('th', { text: k }), el('td', { text: v }));
    table.append(tr);
  }
  wrap.append(table);
  return wrap;
}
