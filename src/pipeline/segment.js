/**
 * Connected-component segmentation of a binary mask (1 = glyph).
 *
 * Returns glyph boxes left-to-right. Blobs that are much shorter than the tallest
 * blob in the line are separators — in practice the colon in "1 : 680" — not
 * digits, so they must never be classified.
 */
export function segment(mask, w, h, opts = {}) {
  const minArea = opts.minArea ?? 12;
  const labels = new Int32Array(mask.length).fill(-1);
  const comps = [];

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const start = y * w + x;
      if (!mask[start] || labels[start] !== -1) continue;

      const id = comps.length;
      const stack = [start];
      labels[start] = id;
      const comp = { id, minX: x, maxX: x, minY: y, maxY: y, area: 0 };

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

  const boxes = comps
    .filter((c) => c.area >= minArea)
    .map((c) => ({
      id: c.id,
      x: c.minX,
      y: c.minY,
      w: c.maxX - c.minX + 1,
      h: c.maxY - c.minY + 1,
      area: c.area,
    }));

  const referenceHeight = boxes.reduce((max, box) => Math.max(max, box.h), 0);

  for (const box of boxes) {
    box.kind = referenceHeight && box.h < referenceHeight * 0.45 ? 'separator' : 'glyph';
  }

  return boxes.sort((a, b) => a.x - b.x);
}
