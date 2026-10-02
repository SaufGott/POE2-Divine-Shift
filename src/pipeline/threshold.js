/**
 * Binarisation. Masks are 1 = glyph, 0 = background.
 */

/** Otsu global threshold. Game panels are dark with light text, so this
 * usually lands between the background and the glyph. */
export function otsu(gray) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i += 1) hist[gray[i]] += 1;

  const total = gray.length;
  let sum = 0;
  for (let v = 0; v < 256; v += 1) sum += hist[v] * v;

  let sumB = 0;
  let wB = 0;
  let best = -1;
  let threshold = 128;

  for (let v = 0; v < 256; v += 1) {
    wB += hist[v];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += hist[v] * v;
    const meanB = sumB / wB;
    const meanF = (sum - sumB) / wF;
    const between = wB * wF * (meanB - meanF) * (meanB - meanF);
    if (between > best) {
      best = between;
      threshold = v;
    }
  }

  return threshold;
}

export function binarize(gray, cutoff) {
  const mask = new Uint8Array(gray.length);
  // Strictly greater: Otsu lands on the background value when the histogram has a
  // flat plateau between the two modes, and `>=` would paint the background as glyph.
  for (let i = 0; i < gray.length; i += 1) mask[i] = gray[i] > cutoff ? 1 : 0;
  return mask;
}

/**
 * Local mean threshold (Bradbury). A pixel is glyph when it is brighter than its
 * neighbourhood mean by `offset`. Game panels have vignette and gradients, so a
 * single global cutoff fails on the edges of the crop.
 *
 * `blockSize` must be larger than a glyph stroke, otherwise the interior of a
 * thick glyph becomes its own background and gets eaten.
 */
export function adaptiveBinarize(gray, w, h, blockSize = 15, offset = 6) {
  const radius = Math.max(1, Math.floor(blockSize / 2));
  const mask = new Uint8Array(w * h);

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let sum = 0;
      let count = 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          sum += gray[ny * w + nx];
          count += 1;
        }
      }

      const mean = sum / count;
      const value = gray[y * w + x];
      mask[y * w + x] = value > mean + offset ? 1 : 0;
    }
  }

  return mask;
}
