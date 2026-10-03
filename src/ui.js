/**
 * DOM rendering. Browser-only.
 * Every render* function reads the shared state object and repaints its panel.
 */

import { analyzeBoth, buildLegs, minimalBatch } from './math.js';
import { buildPlaybook } from './playbook.js';
import { nearestFittingRate, formatRate } from './suggest.js';
import { cropToBuffer, paintMask } from './ocr.js';
import { processFrame } from './pipeline/process.js';

export const PAIRS = [
  { id: 'r1', base: 'c1', quote: 'c2' },
  { id: 'r2', base: 'item', quote: 'c2' },
  { id: 'r3', base: 'c1', quote: 'item' },
];

export function pairLabels(state) {
  const l = state.labels;
  return PAIRS.map((p) => ({ ...p, baseName: l[p.base], quoteName: l[p.quote] }));
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

/* ------------------------------------------------------------------ */
/* Feedback                                                            */
/* ------------------------------------------------------------------ */

export function notify(root, message, kind = 'info') {
  if (!root) return null;

  const toast = el('div', `toast ${kind}`);
  toast.append(el('span', 'toast-accent'), el('span', 'toast-text', message), el('button', 'toast-close', '\u00d7'));

  const dismiss = () => {
    toast.classList.add('leaving');
    setTimeout(() => toast.remove(), 260);
  };

  toast.querySelector('.toast-close').addEventListener('click', dismiss);
  root.appendChild(toast);
  setTimeout(dismiss, 4200);

  return toast;
}

/* ------------------------------------------------------------------ */
/* Capture                                                             */
/* ------------------------------------------------------------------ */

/** The three exchange pairs you can click to choose what the next snapshot fills. */
export function renderPairButtons(state, root, activeId, onPick) {
  root.innerHTML = '';

  for (const pair of pairLabels(state)) {
    const btn = el('button', `pair-btn${pair.id === activeId ? ' active' : ''}`);
    btn.append(
      el('span', 'pair-key', String(PAIRS.findIndex((p) => p.id === pair.id) + 1)),
      el('span', 'pair-name', `${pair.baseName} / ${pair.quoteName}`),
    );
    btn.addEventListener('click', () => onPick(pair.id));
    root.appendChild(btn);
  }
}

/**
 * The region view: the crop itself, drawn at display zoom with the detected glyphs
 * outlined. Zoom only changes what you see, never what is captured.
 */
const scratch = document.createElement('canvas');

export function drawRegionView(canvas, sourceCanvas, state, live) {
  if (!sourceCanvas || !sourceCanvas.width) return;

  const { image, w, h } = cropToBuffer(sourceCanvas, state.region, state.ocr);

  const zoom = Math.max(1, Math.min(8, state.zoom || 1));
  const maxWide = Math.max(120, canvas.parentElement?.clientWidth || 320);
  const maxHigh = 240;
  const scale = Math.max(1, Math.min(zoom, maxWide / w, maxHigh / h));

  scratch.width = w;
  scratch.height = h;
  scratch.getContext('2d').putImageData(image, 0, 0);

  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);

  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(scratch, 0, 0, w, h, 0, 0, canvas.width, canvas.height);

  for (const glyph of live.glyphs || []) {
    if (!glyph.box) continue;
    // Dots get their own colour so you can see whether the pipeline saw the
    // decimal point or read it as a colon.
    ctx.strokeStyle = glyph.kind === 'dot'
      ? '#00b6ff'
      : glyph.kind === 'separator' ? '#837053' : glyph.score ? '#b68022' : '#ff342f';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      glyph.box.x * scale + 0.5,
      glyph.box.y * scale + 0.5,
      glyph.box.w * scale,
      glyph.box.h * scale,
    );
  }
}

/** Small mask preview, kept in the Advanced section. */
export function drawMaskPreview(canvas, sourceCanvas, state) {
  if (!sourceCanvas || !sourceCanvas.width) return;

  const { image, w, h } = cropToBuffer(sourceCanvas, state.region, state.ocr);
  const processed = processFrame(image.data, w, h, state.ocr);

  canvas.width = w;
  canvas.height = h;
  paintMask(canvas.getContext('2d'), processed.raw, w, h, state.ocr.invert);
}

/**
 * One compact line: what is being read, what it says, what it means, how sure we
 * are, and the stable-read streak. The streak never shows more than the number it
 * needs, and turns green when it hits it.
 *
 * "confidence" is the pipeline's own match signal. The vendored Tesseract bundle
 * exposes no confidence at all, so for a Tesseract-only read this is the share of
 * glyph shapes that matched the trained atlas.
 */
export function renderLive(state, root, live) {
  root.innerHTML = '';

  const target = pairLabels(state).find((p) => p.id === live.targetId);
  const shown = live.value || live.lastValue;
  const needed = state.stableRead.needed;
  const streak = Math.min(live.streak || 0, needed);
  const hit = state.stableRead.enabled && streak >= needed;

  const line = el('div', 'live-line');

  line.append(
    el('span', 'live-target', target ? `${target.baseName} / ${target.quoteName}` : '\u2014'),
    el('span', 'live-text', live.text || '\u2014'),
    el('span', 'live-value', shown ? `= ${shown}` : 'no number'),
    el('span', 'live-confidence', live.score ? `confidence ${Math.round(live.score * 100)}%` : 'confidence \u2014'),
    el('span', `live-stable${hit ? ' hit' : ''}`, `${streak}/${needed}`),
  );

  const key = String(shown);
  if (root.dataset.last !== key) {
    root.dataset.last = key;
    line.classList.add('flash');
  }

  root.appendChild(line);
}

/* ------------------------------------------------------------------ */
/* Rates                                                               */
/* ------------------------------------------------------------------ */

export function renderRates(state, root, onOffset, onSuggest, changes = {}) {
  root.innerHTML = '';

  const plain = {};
  for (const key of ['r1', 'r2', 'r3']) plain[key] = state.rates[key].value;

  const pairs = pairLabels(state);
  const suggestions = {};
  for (const pair of pairs) {
    suggestions[pair.id] = nearestFittingRate(plain, pair.id, state.labels, state.budget);
  }

  const notes = pairs
    .filter((pair) => suggestions[pair.id])
    .map((pair) => {
      const batch = minimalBatch(buildLegs(plain, 'forward', state.labels));
      return `${pair.baseName} / ${pair.quoteName}: ${formatRate(plain[pair.id])} needs a batch of ${batch} ${state.labels.c1}, above the budget — nearest that fits is ${formatRate(suggestions[pair.id])}`;
    });

  if (notes.length) {
    const note = el('div', 'fit-note');
    for (const line of notes) note.append(el('div', null, line));
    root.appendChild(note);
  }

  const table = el('table', 'rates-table');
  const head = el('tr');
  ['Pair', 'Rate', 'Change', 'Source'].forEach((h) => head.appendChild(el('th', null, h)));
  table.appendChild(head);

  for (const pair of pairs) {
    const row = el('tr');
    row.appendChild(el('td', 'pair', `${pair.baseName} / ${pair.quoteName}`));

    const value = state.rates[pair.id].value;

    // A rate is always per 1 reference item, so the 1 is not editable. The input
    // shows the value as you typed it (4.5), not as a reduced fraction.
    const num = el('input', 'num-input');
    num.type = 'text';
    num.value = formatRate(value);
    num.title = `exact value ${value.toString()}`;
    num.setAttribute('data-pair', pair.id);

    const one = el('span', 'fixed-one', '1');
    one.title = 'always per 1 reference item';

    // The buttons sit inside the same cell as the input, so they are right next
    // to the rate you are looking at.
    const cell = el('td', 'ratio');
    cell.append(num, el('span', 'slash', '/'), one);

    const minus = el('button', 'offset minus', '\u2212');
    const plus = el('button', 'offset plus', '+');
    minus.title = `subtract ${state.step}`;
    plus.title = `add ${state.step}`;
    minus.addEventListener('click', () => onOffset(pair.id, -1));
    plus.addEventListener('click', () => onOffset(pair.id, 1));
    cell.append(minus, plus);

    if (suggestions[pair.id]) {
      const fit = el('button', 'fit', `\u2192 ${formatRate(suggestions[pair.id])}`);
      fit.title = 'replace this rate with the nearest ratio that fits the budget';
      fit.addEventListener('click', () => onSuggest(pair.id, suggestions[pair.id]));
      cell.append(fit);
    }

    row.appendChild(cell);

    // What the last + / - or suggestion changed, per pair.
    const change = changes[pair.id];
    const changeCell = el('td', 'change');
    if (change) changeCell.textContent = `${change.from} → ${change.to}`;
    row.appendChild(changeCell);

    const source = state.sources[pair.id] || 'manual';
    row.appendChild(el('td', `source ${source}`, source));

    table.appendChild(row);
  }

  root.appendChild(table);
}

/* ------------------------------------------------------------------ */
/* Playbook                                                            */
/* ------------------------------------------------------------------ */

export function renderPlaybook(state, root) {
  root.innerHTML = '';
  const analysis = analyzeBoth(state.rates, state.labels, {
    budget: state.budget,
    allowRemainder: state.allowRemainder,
  }).best;

  const playbook = buildPlaybook({ analysis, labels: state.labels });

  const header = el('div', 'playbook-header');
  header.append(
    el('div', 'cycle', playbook.header.cycle),
    el('div', 'meta', `edge ${playbook.header.edge} % | batch ${playbook.header.batch} ${state.labels.c1}`),
  );
  root.appendChild(header);

  if (playbook.planWarning) root.appendChild(el('div', 'warn', playbook.planWarning));

  const list = el('div', 'playbook');
  for (const step of playbook.steps) {
    const row = el('div', 'playbook-step');
    row.append(el('span', 'step-no', `Step ${step.n}`));

    const body = el('span', 'step-body');
    body.append(
      el('span', null, 'Buy '),
      el('b', 'buy', step.buy),
      el('span', null, ' for '),
      el('b', 'pay', step.pay),
      el('span', null, ' @ '),
      el('span', 'rate', step.rate),
    );
    if (step.leftover) body.append(el('span', 'leftover', ` (leftover ${step.leftover})`));

    row.append(body);
    list.appendChild(row);
  }
  root.appendChild(list);

  const net = el('div', `net ${playbook.net.profit > 0n ? 'pos' : playbook.net.profit < 0n ? 'neg' : ''}`);
  net.append(el('span', 'net-label', 'Net'), el('span', 'net-value', playbook.net.text.replace(/^Net: /, '')));
  root.appendChild(net);
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

export function renderStatus(state, root, message) {
  root.textContent = message ?? state.status ?? 'idle';
  root.className = `status ${state.ocrAvailable ? 'ok' : 'warn'}`;
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
}
