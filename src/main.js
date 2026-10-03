/**
 * Controller: state, event wiring, live OCR, snapshot flow, glyph learning.
 *
 * One fixed capture region on the single market line ("1 : 690"). The visible view
 * is that region only, at display zoom; the full frame is shown only while placing
 * the region. Nothing enters the calculation until you snapshot (or a stable read
 * is accepted).
 */

import { loadState, saveState, clearState, rememberPlacement, placementForFrame } from './storage.js';
import { makeRate } from './math.js';
import { parseRatioLine, parseManual } from './parser.js';
import { formatRate } from './suggest.js';
import { stableRead } from './pipeline/stability.js';
import {
  OcrEngine,
  vendorAvailable,
  startDisplayMedia,
  drawFrame,
  loadImageToCanvas,
} from './ocr.js';
import {
  PAIRS,
  pairLabels,
  renderPairButtons,
  renderLive,
  renderRates,
  renderPlaybook,
  renderStatus,
  drawRegionView,
  drawMaskPreview,
  notify,
  applyTheme,
} from './ui.js';

const $ = (id) => document.getElementById(id);

const state = loadState();
applyTheme(state.theme);

const stageCanvas = $('stage-canvas');
const regionCanvas = $('region-canvas');
const maskCanvas = $('mask-preview');
const overlay = $('region-overlay');
const video = $('video');
const statusEl = $('ocr-status');
const toastRoot = $('toasts');

const engine = new OcrEngine(state.ocr);

let stream = null;
let previewRunning = false;
let previewFrame = null;
let masterBox = null;
let tagEl = null;
let placeMode = false;

let activePair = 'r1';

// state.region is an alias for the placement of the pair you are working on. There
// is one placement per pair because the market UI shows a different row for each;
// switching pairs points the alias at that pair's placement.
state.region = state.placements[activePair];
let liveEnabled = true;
let liveBusy = false;
let lastLiveAt = 0;
let lastRegionDraw = 0;

// What the last + / - or suggestion changed, per pair. Session only: it is a display
// indicator in the rates table, not stored state.
const lastChange = { r1: null, r2: null, r3: null };

// Glyph shapes come from training/atlas.json, loaded once at boot. Training happens
// offline: put PNGs in training/, run node scripts/train.mjs, reload. The app itself
// does not learn at runtime.
let baseAtlas = {};

let live = {
  text: '',
  value: null,
  lastValue: null,
  targetId: 'r1',
  glyphs: [],
  method: 'idle',
  score: 0,
  streak: 0,
  stability: null,
};

/* ------------------------------------------------------------------ */
/* View model                                                          */
/* ------------------------------------------------------------------ */

function ratesView() {
  const l = state.labels;
  return {
    ...state,
    rates: {
      r1: makeRate(l.c1, l.c2, state.rates.r1.num, state.rates.r1.den),
      r2: makeRate(l.item, l.c2, state.rates.r2.num, state.rates.r2.den),
      r3: makeRate(l.c1, l.item, state.rates.r3.num, state.rates.r3.den),
    },
  };
}

/**
 * Switch the pair you are working on. The region moves to that pair's row, because
 * the market UI shows a different row for each pair. Locking pins the position you
 * placed instead: it is carried to the pair you switch to.
 */
function setActivePair(id) {
  const previous = state.placements[activePair];
  const next = state.placements[id];

  if (state.locked && previous) {
    next.x = previous.x;
    next.y = previous.y;
    next.width = previous.width;
    next.height = previous.height;
    next.norm = previous.norm;
  } else if (stageCanvas.width) {
    // A default placement is recorded as fractions the first time it is used on a
    // known frame, so a later resize rebuilds it instead of landing somewhere wrong.
    if (!next.norm) rememberPlacement(state, id);
    else placementForFrame(state, id, stageCanvas.width, stageCanvas.height);
  }

  activePair = id;
  state.region = next;
  live.targetId = id;
  live.lastValue = state.lastSeen[id];

  render();
}

function render() {
  const view = ratesView();

  renderPairButtons(view, $('pair-buttons'), activePair, setActivePair);

  renderLive(view, $('live-read'), live);
  renderRates(view, $('rates-body'), applyOffset, applySuggestion, lastChange);
  renderPlaybook(view, $('playbook-body'));

  drawRegionView(regionCanvas, stageCanvas, state, live);
  drawMaskPreview(maskCanvas, stageCanvas, state);
  positionOverlay();

  $('region-x').value = String(Math.round(state.region.x));
  $('region-y').value = String(Math.round(state.region.y));
  $('zoom-label').textContent = `${state.zoom}x`;
  $('zoom').value = String(state.zoom);

  const pair = pairLabels(state).find((p) => p.id === activePair);
  const norm = state.region.norm;
  $('region-norm').textContent = norm && state.frame.w
    ? `${pair.baseName} / ${pair.quoteName}: x ${(norm.x * 100).toFixed(1)}% · y ${(norm.y * 100).toFixed(1)}% · ${(norm.w * 100).toFixed(1)}% × ${(norm.h * 100).toFixed(1)}% of the ${state.frame.w}x${state.frame.h} frame`
    : `${pair.baseName} / ${pair.quoteName}: position stored as fractions of the frame — place the box once to record it`;
}

/* ------------------------------------------------------------------ */
/* Offsets: undercut or overcut the market                             */
/* ------------------------------------------------------------------ */

function applyOffset(pairId, sign) {
  try {
    const step = parseManual(state.step);
    if (step.isZero()) {
      notify(toastRoot, 'the offset step is 0', 'error');
      return;
    }

    const current = ratesView().rates[pairId].value;
    const next = sign > 0 ? current.add(step) : current.sub(step);

    state.rates[pairId] = { num: String(next.num), den: String(next.den) };
    state.sources[pairId] = 'adjusted';
    lastChange[pairId] = { from: formatRate(current), to: formatRate(next) };

    saveState(state);
    render();
  } catch (error) {
    notify(toastRoot, `offset failed: ${error.message}`, 'error');
  }
}

/** Replace a rate with the nearest ratio that fits the budget. */
function applySuggestion(pairId, candidate) {
  const before = ratesView().rates[pairId].value;

  state.rates[pairId] = { num: String(candidate.num), den: String(candidate.den) };
  state.sources[pairId] = 'adjusted';
  lastChange[pairId] = { from: formatRate(before), to: formatRate(candidate) };

  saveState(state);
  render();

  const pair = pairLabels(state).find((p) => p.id === pairId);
  notify(toastRoot, `${pair.baseName} / ${pair.quoteName} set to ${formatRate(candidate)}, which fits the budget`, 'success');
}

/* ------------------------------------------------------------------ */
/* Region placement (only visible while placing)                       */
/* ------------------------------------------------------------------ */

/** Save the placement for the pair you are working on. */
function commitRegion() {
  rememberPlacement(state, activePair);
  saveState(state);
  render();
}

/**
 * Each placement is stored as fractions of the frame it was placed on. If the
 * captured frame is a different size — resized window, different DPI, another
 * monitor — the pixels are rebuilt from those fractions instead of landing
 * somewhere wrong.
 */
function adoptFrame() {
  if (!stageCanvas.width || !stageCanvas.height) return false;

  if (!state.frame.w || !state.frame.h) {
    state.frame = { w: stageCanvas.width, h: stageCanvas.height };
    for (const id of ['r1', 'r2', 'r3']) rememberPlacement(state, id);
    return false;
  }

  if (state.frame.w === stageCanvas.width && stageCanvas.height === state.frame.h) return false;

  const from = `${Math.round(state.region.x)},${Math.round(state.region.y)}`;
  if (!placementForFrame(state, activePair, stageCanvas.width, stageCanvas.height)) return false;

  renderStatus(state, statusEl, `region rebuilt for a ${stageCanvas.width}x${stageCanvas.height} frame (was at ${from})`);
  notify(toastRoot, `frame size changed — region rebuilt from the stored position`, 'info');
  return true;
}

function setPlaceMode(on) {
  placeMode = on;
  $('place-view').hidden = !on;
  $('place-mode').classList.toggle('active', on);
  render();
}

function buildOverlay() {
  overlay.innerHTML = '';

  masterBox = document.createElement('div');
  masterBox.className = `region-box${state.locked ? ' locked' : ''}`;

  // The label sits above the box so it never covers the area you are dragging into.
  tagEl = document.createElement('span');
  tagEl.className = 'tag';

  const handle = document.createElement('span');
  handle.className = 'handle';
  handle.title = 'drag this corner to change the region size';
  handle.addEventListener('pointerdown', (event) => startResize(event));

  // A dot on each of the other three corners. They are marks, not targets: the
  // pointer passes through them so the box stays draggable from anywhere.
  const corners = ['tl', 'tr', 'bl'].map((pos) => {
    const dot = document.createElement('span');
    dot.className = `corner ${pos}`;
    return dot;
  });

  masterBox.addEventListener('pointerdown', (event) => {
    if (event.target === handle) return;
    startDrag(event);
  });

  masterBox.append(tagEl, ...corners, handle);
  overlay.appendChild(masterBox);

  positionOverlay();
}

function pct(value, total) {
  return `${(value / total) * 100}%`;
}

function positionOverlay() {
  if (!masterBox) return;
  const W = stageCanvas.width || 1;
  const H = stageCanvas.height || 1;

  masterBox.style.left = pct(state.region.x, W);
  masterBox.style.top = pct(state.region.y, H);
  masterBox.style.width = pct(state.region.width, W);
  masterBox.style.height = pct(state.region.height, H);
  masterBox.classList.toggle('locked', state.locked);

  if (!tagEl) return;

  const pair = pairLabels(state).find((p) => p.id === activePair);
  const size = `${Math.round(state.region.width)}x${Math.round(state.region.height)}`;
  tagEl.textContent = state.locked
    ? `locked · ${size}`
    : `scan box · ${pair.baseName} / ${pair.quoteName} · ${size}`;
}

function canvasScale() {
  const rect = stageCanvas.getBoundingClientRect();
  if (!rect.width) return 1;
  return stageCanvas.width / rect.width;
}

function startDrag(event) {
  if (state.locked) return;
  event.preventDefault();
  const scale = canvasScale();
  let lastX = event.clientX;
  let lastY = event.clientY;

  const move = (event) => {
    state.region.x = Math.max(0, Math.min(stageCanvas.width - state.region.width, state.region.x + (event.clientX - lastX) * scale));
    state.region.y = Math.max(0, Math.min(stageCanvas.height - state.region.height, state.region.y + (event.clientY - lastY) * scale));
    lastX = event.clientX;
    lastY = event.clientY;
    positionOverlay();
  };

  const up = () => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    commitRegion();
  };

  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
}

function startResize(event) {
  if (state.locked) return;
  event.preventDefault();
  event.stopPropagation();
  const scale = canvasScale();
  let lastX = event.clientX;
  let lastY = event.clientY;

  const move = (event) => {
    state.region.width = Math.max(20, Math.min(stageCanvas.width - state.region.x, state.region.width + (event.clientX - lastX) * scale));
    state.region.height = Math.max(10, Math.min(stageCanvas.height - state.region.y, state.region.height + (event.clientY - lastY) * scale));
    lastX = event.clientX;
    lastY = event.clientY;
    positionOverlay();
  };

  const up = () => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    commitRegion();
  };

  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
}

/* ------------------------------------------------------------------ */
/* OCR                                                                 */
/* ------------------------------------------------------------------ */

async function readRegion({ force = false } = {}) {
  if (!engine.worker) return null;

  const r = state.region;
  const result = await engine.recognizeRegion(
    stageCanvas,
    { id: 'region', x: r.x, y: r.y, width: r.width, height: r.height },
    baseAtlas,
    { force },
  );

  const text = (result.text || '').trim();
  return { ...result, text, value: parseRatioLine(text) };
}

function advancePair() {
  const index = PAIRS.findIndex((p) => p.id === activePair);
  activePair = PAIRS[(index + 1) % PAIRS.length].id;
  live.targetId = activePair;
  live.lastValue = state.lastSeen[activePair];
}

function fillPair(pairId, read, fallbackValue = null) {
  const value = read.value || fallbackValue;
  if (!value) return null;

  state.rates[pairId] = { num: String(value.num), den: String(value.den) };
  state.sources[pairId] = read.method === 'auto' ? 'auto' : 'snapshot';

  return value;
}

async function snapshotValue() {
  if (!engine.worker) {
    notify(toastRoot, 'OCR worker not ready — see the status line, then reload', 'error');
    return;
  }

  if (video.srcObject && video.videoWidth) {
    drawFrame(video, stageCanvas);
    adoptFrame();
  }

  try {
    const read = await readRegion({ force: true });
    const pair = pairLabels(state).find((p) => p.id === activePair);
    const label = `${pair.baseName} / ${pair.quoteName}`;

    const value = fillPair(activePair, read, live.value || state.lastSeen[activePair]);

    live = {
      ...live,
      text: read.text,
      value: read.value,
      lastValue: value,
      targetId: activePair,
      glyphs: read.glyphs || [],
      method: read.method || 'snapshot',
      score: read.score || 0,
    };

    if (value) {
      renderStatus(state, statusEl, `${label} <- "${read.text}" = ${value}`);
      notify(toastRoot, `${label} captured: ${value}`, 'success');
    } else {
      renderStatus(state, statusEl, `${label}: nothing readable in "${read.text || 'empty'}"`);
      notify(toastRoot, `${label}: nothing readable in this crop — using last seen value`, 'error');
    }

    advancePair();
    saveState(state);
    render();
  } catch (error) {
    console.error('[snapshot]', error);
    renderStatus(state, statusEl, `snapshot failed: ${error.message}`);
    notify(toastRoot, `snapshot failed: ${error.message}`, 'error');
  }
}

/* ------------------------------------------------------------------ */
/* Live preview + live readout                                         */
/* ------------------------------------------------------------------ */

async function liveLoop() {
  if (!previewRunning) return;

  if (video.videoWidth) {
    const resized = drawFrame(video, stageCanvas);
    if (resized) {
      if (adoptFrame()) saveState(state);
      positionOverlay();
    }
  }

  const now = Date.now();
  if (liveEnabled && engine.worker && !liveBusy && now - lastLiveAt >= state.ocr.liveIntervalMs) {
    lastLiveAt = now;
    liveBusy = true;

    try {
      const read = await readRegion();

      if (read) {
        const stability = stableRead(live.stability, read.text, state.stableRead.needed);

        live = {
          ...live,
          text: read.text,
          value: read.value,
          lastValue: read.value || live.lastValue || state.lastSeen[activePair],
          targetId: activePair,
          glyphs: read.glyphs || [],
          method: read.method || 'idle',
          score: read.score || 0,
          streak: stability.streak,
          stability,
        };

        if (read.value) state.lastSeen[activePair] = String(read.value);

        if (state.stableRead.enabled && stability.accepted && read.value) {
          const pair = pairLabels(state).find((p) => p.id === activePair);
          const label = `${pair.baseName} / ${pair.quoteName}`;

          fillPair(activePair, read);
          renderStatus(state, statusEl, `${label} <- stable read ${read.text} = ${read.value}`);
          notify(toastRoot, `${label}: stable read accepted after ${stability.streak} identical reads`, 'success');
          advancePair();
          saveState(state);
        }
      }
    } catch (error) {
      // A dropped frame is not worth a message, but a real failure is — this catch
      // used to hide exactly the kind of bug that only showed up on Snapshot.
      renderStatus(state, statusEl, `live read failed: ${error.message}`);
    } finally {
      liveBusy = false;
      render();
    }
  } else if (now - lastRegionDraw >= 120) {
    lastRegionDraw = now;
    drawRegionView(regionCanvas, stageCanvas, state, live);
  }

  previewFrame = requestAnimationFrame(liveLoop);
}

async function startOcr() {
  try {
    stream = await startDisplayMedia(video);
    $('stop-capture').disabled = false;
    renderStatus(state, statusEl, 'OCR live — pick a pair, open the trade in game, then Snapshot value');
    stream.getVideoTracks()[0]?.addEventListener('ended', () => stopPreview('preview ended'));
    previewRunning = true;
    liveLoop();
  } catch (error) {
    renderStatus(state, statusEl, `capture failed: ${error.message}`);
    notify(toastRoot, `capture failed: ${error.message}`, 'error');
  }
}

function stopPreview(reason = 'preview stopped') {
  previewRunning = false;
  if (previewFrame) cancelAnimationFrame(previewFrame);
  previewFrame = null;
  stream?.getVideoTracks?.().forEach((track) => track.stop());
  stream = null;
  video.srcObject = null;
  $('stop-capture').disabled = true;
  renderStatus(state, statusEl, reason);
}

/* ------------------------------------------------------------------ */
/* Input wiring                                                        */
/* ------------------------------------------------------------------ */

function bindInputs() {
  for (const [id, key] of [['label-c1', 'c1'], ['label-c2', 'c2'], ['label-item', 'item']]) {
    const input = $(id);
    input.value = state.labels[key];
    input.addEventListener('input', () => {
      state.labels[key] = input.value.trim() || state.labels[key];
      saveState(state);
      render();
    });
  }

  $('rates-body').addEventListener('change', (event) => {
    const pairId = event.target.getAttribute('data-pair');
    if (!pairId) return;
    try {
      const value = parseManual(event.target.value);
      state.rates[pairId] = { num: String(value.num), den: String(value.den) };
      state.sources[pairId] = 'manual';
      saveState(state);
      render();
    } catch {
      event.target.classList.add('invalid');
    }
  });

  const step = $('offset-step');
  step.value = String(state.step);
  step.addEventListener('change', () => {
    try {
      state.step = parseManual(step.value).toString();
      step.classList.remove('invalid');
      saveState(state);
      render();
    } catch {
      step.classList.add('invalid');
    }
  });

  const budget = $('budget');
  budget.value = String(state.budget);
  budget.addEventListener('input', () => {
    state.budget = Math.max(0, Number(budget.value) || 0);
    saveState(state);
    render();
  });

  const remainder = $('allow-remainder');
  remainder.checked = state.allowRemainder;
  remainder.addEventListener('change', () => {
    state.allowRemainder = remainder.checked;
    saveState(state);
    render();
  });

  for (const [id, axis] of [['region-x', 'x'], ['region-y', 'y']]) {
    const input = $(id);
    input.value = String(Math.round(state.region[axis]));
    input.addEventListener('change', () => {
      state.region[axis] = Math.max(0, Number(input.value) || 0);
      commitRegion();
    });
  }

  const regionW = $('region-width');
  const regionH = $('region-height');
  regionW.value = String(Math.round(state.region.width));
  regionH.value = String(Math.round(state.region.height));
  for (const input of [regionW, regionH]) {
    input.addEventListener('input', () => {
      state.region.width = Math.max(20, Number(regionW.value) || 20);
      state.region.height = Math.max(10, Number(regionH.value) || 10);
      commitRegion();
    });
  }

  const zoom = $('zoom');
  zoom.value = String(state.zoom);
  const setZoom = (value) => {
    state.zoom = Math.min(8, Math.max(1, Number(value) || 1));
    saveState(state);
    render();
  };
  zoom.addEventListener('input', () => setZoom(zoom.value));
  $('zoom-in').addEventListener('click', () => setZoom(state.zoom + 1));
  $('zoom-out').addEventListener('click', () => setZoom(state.zoom - 1));

  $('place-mode').addEventListener('click', () => setPlaceMode(!placeMode));

  const ocrScale = $('ocr-scale');
  const minStroke = $('min-stroke');
  const liveInterval = $('live-interval');
  ocrScale.value = String(state.ocr.scale);
  minStroke.value = String(state.ocr.minStroke);
  liveInterval.value = String(state.ocr.liveIntervalMs);

  ocrScale.addEventListener('input', () => {
    state.ocr.scale = Math.min(6, Math.max(1, Number(ocrScale.value) || 3));
    saveState(state);
    render();
  });
  minStroke.addEventListener('input', () => {
    state.ocr.minStroke = Math.min(6, Math.max(1, Number(minStroke.value) || 2));
    saveState(state);
    render();
  });
  liveInterval.addEventListener('input', () => {
    state.ocr.liveIntervalMs = Math.min(2000, Math.max(100, Number(liveInterval.value) || 400));
    saveState(state);
  });

  const mode = $('threshold-mode');
  mode.value = state.ocr.mode;
  mode.addEventListener('change', () => {
    state.ocr.mode = mode.value;
    saveState(state);
    render();
  });

  const outline = $('outline');
  const invert = $('invert');
  const cutoff = $('cutoff');
  outline.checked = state.ocr.outline;
  invert.checked = state.ocr.invert;
  cutoff.value = String(state.ocr.cutoff);

  const applyOcr = () => {
    state.ocr.outline = outline.checked;
    state.ocr.invert = invert.checked;
    state.ocr.cutoff = Math.min(220, Math.max(40, Number(cutoff.value) || 128));
    saveState(state);
    render();
  };

  for (const input of [outline, invert, cutoff]) {
    input.addEventListener('change', applyOcr);
    input.addEventListener('input', applyOcr);
  }

  const stableToggle = $('stable-read');
  const stableNeeded = $('stable-needed');
  stableToggle.checked = state.stableRead.enabled;
  stableNeeded.value = String(state.stableRead.needed);

  const applyStable = () => {
    state.stableRead.enabled = stableToggle.checked;
    state.stableRead.needed = Math.min(10, Math.max(1, Number(stableNeeded.value) || 3));
    live.stability = null;
    live.streak = 0;
    saveState(state);
    render();
  };

  for (const input of [stableToggle, stableNeeded]) {
    input.addEventListener('change', applyStable);
    input.addEventListener('input', applyStable);
  }

  const lock = $('lock-region');
  lock.checked = state.locked;
  lock.addEventListener('change', () => {
    state.locked = lock.checked;
    saveState(state);
    render();
    if (lock.checked) notify(toastRoot, 'region locked — position and scale fixed', 'info');
  });

  const liveToggle = $('live-ocr');
  liveToggle.checked = liveEnabled;
  liveToggle.addEventListener('change', () => {
    liveEnabled = liveToggle.checked;
    render();
  });

  $('start-ocr').addEventListener('click', startOcr);
  $('stop-capture').addEventListener('click', () => stopPreview());
  $('snapshot').addEventListener('click', snapshotValue);

  $('theme-toggle').addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme(state.theme);
    $('theme-toggle').textContent = state.theme;
    saveState(state);
  });
  $('theme-toggle').textContent = state.theme;

  $('reset').addEventListener('click', () => {
    clearState();
    location.reload();
  });

  const acceptImage = async (file) => {
    if (!file) return;
    await loadImageToCanvas(file, stageCanvas);
    adoptFrame();
    saveState(state);
    render();
    notify(toastRoot, 'screenshot loaded — place the box on the line, then Snapshot value', 'info');
  };

  document.addEventListener('paste', async (event) => {
    const item = Array.from(event.clipboardData?.items || []).find((i) => i.type.startsWith('image/'));
    if (!item) return;
    await acceptImage(await item.getAsFile());
  });

  $('place-view').addEventListener('dragover', (event) => event.preventDefault());
  $('place-view').addEventListener('drop', async (event) => {
    event.preventDefault();
    await acceptImage(event.dataTransfer?.files?.[0]);
  });

  document.addEventListener('keydown', (event) => {
    if (event.target.matches('input, textarea, select')) return;

    if (event.key >= '1' && event.key <= '3') {
      const pair = PAIRS[Number(event.key) - 1];
      if (pair) setActivePair(pair.id);
      return;
    }

    if (event.code === 'Space') {
      event.preventDefault();
      snapshotValue();
      return;
    }

    if (event.key.toLowerCase() === 'p') {
      setPlaceMode(!placeMode);
      return;
    }

    if (event.key.toLowerCase() === 'l') {
      state.locked = !state.locked;
      $('lock-region').checked = state.locked;
      saveState(state);
      render();
      notify(toastRoot, state.locked ? 'region locked' : 'region unlocked', 'info');
    }

    if (event.key === '+' || event.key === '=') setZoom(state.zoom + 1);
    if (event.key === '-') setZoom(state.zoom - 1);
  });
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

async function loadBaseAtlas() {
  try {
    const response = await fetch('training/atlas.json');
    if (!response.ok) return null;
    const data = await response.json();
    return data && data.digits ? data.digits : null;
  } catch {
    return null;
  }
}

async function boot() {
  bindInputs();
  buildOverlay();

  const trained = await loadBaseAtlas();
  if (trained) {
    baseAtlas = trained;
    renderStatus(state, statusEl, `loaded ${Object.keys(trained).length} trained glyphs from training/`);
  }

  state.ocrAvailable = await vendorAvailable();

  if (state.ocrAvailable) {
    renderStatus(state, statusEl, 'loading OCR worker…');
    try {
      await engine.init((message) => {
        if (message?.status) renderStatus(state, statusEl, `OCR: ${message.status}`);
      });
      renderStatus(state, statusEl, 'OCR ready — pick a pair, then Snapshot value');
    } catch (error) {
      state.ocrAvailable = false;
      renderStatus(state, statusEl, `OCR init failed: ${error.message}`);
    }
  } else {
    renderStatus(
      state,
      statusEl,
      'vendor/ assets missing — run `node scripts/fetch-vendor.mjs` once; manual entry still works',
    );
  }

  render();
}

boot();
