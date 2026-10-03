/**
 * Connected-component segmentation of a binary mask (1 = glyph).
 *
 * Returns boxes left-to-right, each with a kind:
 *   glyph      - a full-height blob, the thing the atlas classifies
 *   separator  - the colon in "1 : 680"
 *   dot        - a decimal point in "4.5"
 *
 * Two things the height rule alone could not do:
 *   - a period is a handful of pixels at capture scale 1, so it needs its own lower
 *     area floor. With the digit floor it was dropped and "4.5" came back as "45".
 *   - a period is short, so "much shorter than the tallest blob" called it a
 *     separator and the line was rebuilt as "4 : 5", which parses as 1.25.
 *
 * They are told apart by shape and position, not by matching: a colon is two dots
 * stacked in one column, or a lone dot standing in whitespace; a decimal point is a
 * single square dot sitting tight against a digit.
 */
export function segment(mask, w, h, opts = {}) {
  const minArea = opts.minArea ?? 12;
  const minDotArea = opts.minDotArea ?? 4;
  const shortRatio = opts.shortRatio ?? 0.45;
  const tightRatio = opts.tightRatio ?? 0.3;
  const columnTolerance = opts.columnTolerance ?? 1;

  const labels = new Int32Array(mask.length).fill(-1);
  const comps = [];

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const start = y * w + x;
      if (!mask[start] || labels[start] !== -1) continue;

      const id = comps.length;
      const stack = [start];
      labels[start] = id;
      const comp = { id, minX: x, minY: y, maxX: x, maxY: y, area: 0 };

      while (stack.length) {
        const i = stack.pop();
        const cy = (i / w) | 0;
        const cx = i % w;

        comp.area += 1;
        if (cx < comp.minX) comp.minX = cx;
        if (cx > comp.maxX) comp.maxX = cx;
        if (cy < comp.minY) comp.minY = cy;
        if (cy > comp.maxY) comp.maxY = cy;

        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (!dx && !dy) continue;
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const j = ny * w + nx;
            if (mask[j] && labels[j] === -1) {
              labels[j] = id;
              stack.push(j);
            }
          }
        }
      }

      comps.push(comp);
    }
  }

  const heightOf = (comp) => comp.maxY - comp.minY + 1;
  const referenceHeight = comps.reduce((max, comp) => Math.max(max, heightOf(comp)), 0);

  const isShort = (comp) => referenceHeight && heightOf(comp) < referenceHeight * shortRatio;

  const boxes = comps
    .filter((comp) => comp.area >= (isShort(comp) ? minDotArea : minArea))
    .map((comp) => ({
      id: comp.id,
      x: comp.minX,
      y: comp.minY,
      w: comp.maxX - comp.minX + 1,
      h: heightOf(comp),
      area: comp.area,
      kind: isShort(comp) ? 'dot' : 'glyph',
    }))
    .sort((a, b) => a.x - b.x);

  const dots = boxes.filter((box) => box.kind === 'dot');
  const digits = boxes.filter((box) => box.kind === 'glyph');
  const tightLimit = Math.max(1, Math.round(referenceHeight * tightRatio));

  // Dots in the same column are the two halves of one colon.
  const clusters = [];
  for (const box of dots) {
    const cluster = clusters.find((members) =>
      members.some((m) => m.x <= box.x + box.w + columnTolerance && box.x <= m.x + m.w + columnTolerance),
    );
    if (cluster) cluster.push(box);
    else clusters.push([box]);
  }

  for (const cluster of clusters) {
    if (cluster.length > 1) {
      for (const box of cluster) box.kind = 'separator';
      continue;
    }

    const box = cluster[0];
    // A period is square and sits against a digit. A blob too tall for its width is
    // the colon's two dots merged by anti-aliasing, and a lone dot with a wide gap
    // on both sides is a colon standing in whitespace — its other dot was lost.
    const gap = nearestGap(box, digits);
    if (box.h <= box.w * 1.5 && gap !== null && gap <= tightLimit) continue;
    box.kind = 'separator';
  }

  return boxes;
}

/** Horizontal gap from a dot to the nearest digit, or null when there is none. */
function nearestGap(box, digits) {
  let best = null;

  for (const digit of digits) {
    const gap = digit.x >= box.x + box.w ? digit.x - (box.x + box.w) : box.x - (digit.x + digit.w);
    if (gap < 0) continue;
    if (best === null || gap < best) best = gap;
  }

  return best;
}
