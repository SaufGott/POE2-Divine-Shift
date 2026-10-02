/**
 * localStorage persistence for the dashboard state.
 * Browser-only (guarded), so the pure modules stay testable in Node.
 *
 * Only keys the app can actually change or read are stored. Pipeline defaults that
 * have no UI live in the pipeline modules themselves, not here.
 *
 * One placement per pair, because the market UI shows a different row for each pair.
 * Pixels are what you edit; norm is the same placement as fractions of the frame it
 * was placed on, so a window resize or a DPI change does not move it.
 */

const KEY = 'poe2-arb-dashboard-v7';

// Positions that read reliably for the three market rows, for the window they were
// observed on. Placing the box for a pair updates that pair's placement.
export const DEFAULT_PLACEMENTS = {
  r1: { x: 784, y: 551, width: 100, height: 30 },
  r2: { x: 765, y: 615, width: 100, height: 30 },
  r3: { x: 787, y: 548, width: 100, height: 30 },
};

export const DEFAULT_STATE = {
  labels: { c1: 'Div', c2: 'Ex', item: 'Omen' },
  rates: {
    r1: { num: 48, den: 1 },
    r2: { num: 9, den: 2 },
    r3: { num: 10, den: 1 },
  },

  placements: {
    r1: { ...DEFAULT_PLACEMENTS.r1, norm: null },
    r2: { ...DEFAULT_PLACEMENTS.r2, norm: null },
    r3: { ...DEFAULT_PLACEMENTS.r3, norm: null },
  },

  // Locking pins the region: switching pairs no longer moves it.
  locked: false,

  // The frame size the current placement was recorded on. 0 means "never placed".
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

    for (const key of ['labels', 'rates', 'ocr', 'stableRead', 'sources', 'lastSeen', 'frame']) {
      merged[key] = { ...base[key], ...(saved[key] || {}) };
    }

    for (const pair of ['r1', 'r2', 'r3']) {
      merged.placements[pair] = { ...base.placements[pair], ...(saved.placements?.[pair] || {}) };
    }

    return merged;
  } catch {
    return base;
  }
}

/** Store a placement as fractions of the frame it sits on. */
export function rememberPlacement(state, pairId) {
  const placement = state.placements[pairId];
  const frame = state.frame;
  if (!placement || !frame.w || !frame.h) return;

  placement.norm = {
    x: placement.x / frame.w,
    y: placement.y / frame.h,
    w: placement.width / frame.w,
    h: placement.height / frame.h,
  };
}

/**
 * Rebuild a placement's pixels for a different frame size. Returns false when there
 * is nothing to rebuild from, so the caller keeps the stored pixels.
 */
export function placementForFrame(state, pairId, frameW, frameH) {
  const placement = state.placements[pairId];
  const norm = placement?.norm;
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
  placement.x = x;
  placement.y = y;
  placement.width = width;
  placement.height = height;

  return true;
}

export function saveState(state) {
  if (typeof localStorage === 'undefined') return;
  try {
    // state.region is an alias for the placement of the active pair, not stored state.
    const { region, ...stored } = state;
    localStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    /* quota or private mode: ignore */
  }
}

export function clearState() {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(KEY);
}
