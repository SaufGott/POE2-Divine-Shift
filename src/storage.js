/**
 * localStorage persistence for the dashboard state.
 * Browser-only (guarded), so the pure modules stay testable in Node.
 *
 * Only keys the app can actually change or read are stored. Pipeline defaults that
 * have no UI live in the pipeline modules themselves, not here.
 */

const KEY = 'poe2-arb-dashboard-v6';

export const DEFAULT_STATE = {
  labels: { c1: 'Div', c2: 'Ex', item: 'Omen' },
  rates: {
    r1: { num: 48, den: 1 },
    r2: { num: 9, den: 2 },
    r3: { num: 10, den: 1 },
  },

  // One fixed capture region on the single market line, e.g. "1 : 690".
  // Pixels are what you edit; norm is the same region as fractions of the frame it
  // was placed on, so a window resize or a DPI change does not move it.
  region: {
    x: 60,
    y: 80,
    width: 100,
    height: 30,
    locked: false,
    norm: null,
  },

  // The frame size the region was placed on. 0 means "never placed".
  frame: { w: 0, h: 0 },

  // Display zoom for the region view only. It does not change what is captured.
  zoom: 3,

  // What the + / - buttons move a rate by. Decimals are allowed (4.5 is exact).
  step: 1,

  budget: 100,
  allowRemainder: true,

  ocr: {
    mode: 'otsu',
    cutoff: 128,
    blockSize: 15,
    offset: 6,
    outline: true,
    minStroke: 2,
    scale: 3,
    invert: false,
    liveIntervalMs: 400,
  },
  theme: 'dark',

  // Accept a value only after it is read identically N times.
  stableRead: { enabled: false, needed: 3 },

  sources: { r1: 'manual', r2: 'manual', r3: 'manual' },

  // Last value seen per pair, used as a fallback when a snapshot reads nothing.
  lastSeen: { r1: null, r2: null, r3: null },
};

export function loadState() {
  const base = structuredClone(DEFAULT_STATE);
  if (typeof localStorage === 'undefined') return base;

  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw);
    const merged = { ...base, ...saved };
    for (const key of ['labels', 'rates', 'region', 'frame', 'ocr', 'stableRead', 'sources', 'lastSeen']) {
      merged[key] = { ...base[key], ...(saved[key] || {}) };
    }
    return merged;
  } catch {
    return base;
  }
}

/** Store the current pixel region as fractions of the frame it sits on. */
export function rememberRegionNorm(state) {
  const frame = state.frame;
  if (!frame.w || !frame.h) return;

  state.region.norm = {
    x: state.region.x / frame.w,
    y: state.region.y / frame.h,
    w: state.region.width / frame.w,
    h: state.region.height / frame.h,
  };
}

/**
 * Rebuild the pixel region for a different frame size. Returns false when there is
 * nothing to rebuild from, so the caller keeps the stored pixels.
 */
export function regionForFrame(state, frameW, frameH) {
  const norm = state.region.norm;
  if (!norm || !frameW || !frameH) return false;

  const clamp = (value, low, high) => Math.max(low, Math.min(value, high));
  const minW = Math.min(20, frameW);
  const minH = Math.min(10, frameH);

  // Position first, so the size can never run past the edge of the frame.
  const x = clamp(Math.round(norm.x * frameW), 0, frameW - minW);
  const y = clamp(Math.round(norm.y * frameH), 0, frameH - minH);
  const width = clamp(Math.round(norm.w * frameW), minW, frameW - x);
  const height = clamp(Math.round(norm.h * frameH), minH, frameH - y);

  state.frame = { w: frameW, h: frameH };
  state.region.x = x;
  state.region.y = y;
  state.region.width = width;
  state.region.height = height;

  return true;
}

export function saveState(state) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* quota or private mode: ignore */
  }
}

export function clearState() {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(KEY);
}
