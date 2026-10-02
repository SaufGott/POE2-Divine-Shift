/**
 * Pixel helpers. Pure: they work on plain byte buffers, not DOM canvases, so the
 * whole OCR path can be unit-tested in Node.
 *
 * A "frame" here is { width, height, data } where data is a Uint8Array of
 * width * height bytes, one luminance value per pixel.
 */

/**
 * ITU-R 601 luma from RGBA bytes.
 *
 * The coefficients must sum to 256 for a shift of 8 to be correct: 77 + 150 + 29.
 * The common 299/587/114 form sums to 1000 and needs a division by 1000 instead —
 * using it with >> 8 produced values up to 996, which wrapped in the Uint8Array and
 * scrambled the brightness order.
 */
export function toGray(rgba, w, h) {
  const gray = new Uint8Array(w * h);
  for (let i = 0; i < rgba.length; i += 4) {
    gray[i >> 2] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
  }
  return gray;
}

/** Cheap pixel hash so unchanged crops are not re-processed every poll. */
export function frameHash(data) {
  let h = 2166136261;
  for (let i = 0; i < data.length; i += 1) {
    h ^= data[i];
    h = (h * 16777619) >>> 0;
  }
  return h >>> 0;
}
