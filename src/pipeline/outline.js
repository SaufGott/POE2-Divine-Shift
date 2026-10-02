/**
 * Strip the glyph outline.
 *
 * A majority rule ("a dark pixel with mostly light neighbours") cannot remove a
 * ring, because a ring pixel touching the glyph has more glyph neighbours than
 * background ones. What does work: find which class is the background from the
 * border, then measure how far every remaining pixel is from the nearest
 * background pixel. A 1 px outline ring sits at distance 1 and is dropped; a real
 * stroke is deeper and survives.
 *
 * The distance must be to *any* background pixel, not only the part connected to
 * the border — a closed outline ring is never reachable from the border, and the
 * counter inside an 8 or a 0 is background even though it is enclosed.
 *
 * minStroke = 1 removes nothing (use it when the outline is already the
 * background class). 2 is the working default.
 *
 * `mask` is 1 = glyph, 0 = background; returns a new mask.
 */
export function removeOutline(mask, w, h, minStroke = 2) {
  const size = w * h;

  // Background = whatever dominates the border of the crop.
  let borderGlyph = 0;
  let borderCount = 0;

  for (let x = 0; x < w; x += 1) {
    borderCount += 2;
    borderGlyph += mask[x] + mask[(h - 1) * w + x];
  }
  for (let y = 1; y < h - 1; y += 1) {
    borderCount += 2;
    borderGlyph += mask[y * w] + mask[y * w + w - 1];
  }

  const bgClass = borderGlyph * 2 > borderCount ? 1 : 0;
  const glyphClass = 1 - bgClass;

  // Chebyshev distance to the nearest background pixel, two passes.
  const INF = 1e9;
  const dist = new Int32Array(size);
  for (let i = 0; i < size; i += 1) dist[i] = mask[i] === bgClass ? 0 : INF;

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      if (dist[i] === 0) continue;
      let best = dist[i];
      for (const [dy, dx] of [[-1, -1], [-1, 0], [-1, 1], [0, -1]]) {
        const ny = y + dy;
        const nx = x + dx;
        if (ny < 0 || nx < 0 || ny >= h || nx >= w) continue;
        const d = dist[ny * w + nx] + 1;
        if (d < best) best = d;
      }
      dist[i] = best;
    }
  }

  for (let y = h - 1; y >= 0; y -= 1) {
    for (let x = w - 1; x >= 0; x -= 1) {
      const i = y * w + x;
      if (dist[i] === 0) continue;
      let best = dist[i];
      for (const [dy, dx] of [[1, -1], [1, 0], [1, 1], [0, 1]]) {
        const ny = y + dy;
        const nx = x + dx;
        if (ny < 0 || nx < 0 || ny >= h || nx >= w) continue;
        const d = dist[ny * w + nx] + 1;
        if (d < best) best = d;
      }
      dist[i] = best;
    }
  }

  const out = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) {
    if (mask[i] !== glyphClass) continue;
    out[i] = dist[i] >= minStroke ? 1 : 0;
  }

  return out;
}
