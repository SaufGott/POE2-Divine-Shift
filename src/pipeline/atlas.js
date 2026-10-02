/**
 * Self-learning glyph atlas.
 *
 * The game font is fixed, so once a digit has been read confidently its shape can
 * be kept as a template and matched locally — no Tesseract, no network, and it
 * works on the outline as it actually appears on screen.
 *
 * Templates are stored as "0"/"1" strings of ATLAS_SIZE * ATLAS_SIZE so they can
 * live in localStorage. Each digit keeps up to MAX_SAMPLES shapes, and matching
 * takes the best one.
 */

export const ATLAS_SIZE = 16;
export const MAX_SAMPLES = 5;

/** Nearest-neighbour resize of a component box into the atlas grid. */
export function normalize(mask, w, h, box, size = ATLAS_SIZE) {
  const out = new Uint8Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sx = box.x + Math.floor((x * box.w) / size);
      const sy = box.y + Math.floor((y * box.h) / size);
      out[y * size + x] = mask[sy * w + sx] ? 1 : 0;
    }
  }
  return out;
}

export function encode(bitmap) {
  if (!bitmap || typeof bitmap.length !== 'number') {
    throw new Error('encode expects a bitmap, not a result object');
  }

  let hex = '';
  for (let i = 0; i < bitmap.length; i += 1) hex += bitmap[i] ? '1' : '0';
  return hex;
}

export function decode(hex, size = ATLAS_SIZE) {
  if (typeof hex !== 'string' || hex.length !== size * size) return null;
  const out = new Uint8Array(size * size);
  for (let i = 0; i < out.length; i += 1) out[i] = hex[i] === '1' ? 1 : 0;
  return out;
}

export function matchScore(a, b) {
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) diff += 1;
  return 1 - diff / a.length;
}

/**
 * Match with a tolerance in pixels. A lit pixel counts as matching if the other
 * bitmap has a lit pixel within `tolerance` of it, averaged over both directions.
 * Exact matching breaks on anti-aliasing and subpixel shifts, which is exactly what
 * happens between a training crop and a live capture.
 */
export function matchScoreTolerant(a, b, tolerance = 1, size = ATLAS_SIZE) {
  const aLit = [];
  const bLit = [];

  for (let i = 0; i < a.length; i += 1) if (a[i]) aLit.push(i);
  for (let i = 0; i < b.length; i += 1) if (b[i]) bLit.push(i);

  if (!aLit.length && !bLit.length) return 1;
  if (!aLit.length || !bLit.length) return 0;

  const aSet = new Set(aLit);
  const bSet = new Set(bLit);

  const near = (index, set) => {
    const x = index % size;
    const y = (index / size) | 0;
    for (let dy = -tolerance; dy <= tolerance; dy += 1) {
      for (let dx = -tolerance; dx <= tolerance; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        if (set.has(ny * size + nx)) return true;
      }
    }
    return false;
  };

  let hitsA = 0;
  for (const index of aLit) if (near(index, bSet)) hitsA += 1;

  let hitsB = 0;
  for (const index of bLit) if (near(index, aSet)) hitsB += 1;

  return (hitsA / aLit.length + hitsB / bLit.length) / 2;
}

export function learn(atlas, digit, bitmap, size = ATLAS_SIZE) {
  const samples = atlas[digit] || [];
  const hex = encode(bitmap);

  if (!samples.includes(hex)) {
    samples.push(hex);
    if (samples.length > MAX_SAMPLES) samples.shift();
    atlas[digit] = samples;
  }

  return atlas;
}

export function classify(atlas, bitmap, minScore = 0.8, size = ATLAS_SIZE, tolerance = 1) {
  let best = null;

  for (const [digit, samples] of Object.entries(atlas)) {
    if (!Array.isArray(samples)) continue;
    for (const hex of samples) {
      const template = decode(hex, size);
      if (!template) continue;
      const score = tolerance > 0
        ? matchScoreTolerant(bitmap, template, tolerance, size)
        : matchScore(bitmap, template);
      if (!best || score > best.score) best = { digit, score };
    }
  }

  return best && best.score >= minScore ? best : null;
}

/** Base templates from training/atlas.json plus the shapes learned at runtime. */
export function mergeAtlas(base, runtime) {
  const merged = {};

  for (const source of [base, runtime]) {
    for (const [digit, samples] of Object.entries(source || {})) {
      if (!Array.isArray(samples)) continue;
      merged[digit] = [...(merged[digit] || []), ...samples.filter((hex) => !(merged[digit] || []).includes(hex))];
    }
  }

  return merged;
}
