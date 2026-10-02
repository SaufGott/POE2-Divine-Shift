/**
 * Full preprocessing on a plain pixel buffer: gray -> threshold -> outline strip.
 *
 * Pure so the whole OCR path can be tested without a browser. The DOM wrapper in
 * src/ocr.js only draws the crop and hands the pixels here.
 */

import { toGray, frameHash } from './gray.js';
import { otsu, binarize, adaptiveBinarize } from './threshold.js';
import { removeOutline } from './outline.js';

/**
 * mode: 'otsu' (auto cutoff), 'fixed' (the cutoff you set), or 'adaptive'
 * (local mean, better when the panel has a gradient or vignette).
 *
 * Two masks: `raw` is what the glyph atlas matches against — the training step
 * never strips outlines, so the live path must not either. `mask` is the stripped
 * one used for Tesseract, which is where outline removal actually helps.
 */
export function processFrame(rgba, w, h, opts = {}) {
  const gray = toGray(rgba, w, h);

  const mode = opts.mode || (opts.autoThreshold ? 'otsu' : 'fixed');
  const cutoff = mode === 'otsu' ? otsu(gray) : (opts.cutoff ?? 128);

  const raw = mode === 'adaptive'
    ? adaptiveBinarize(gray, w, h, opts.blockSize ?? 15, opts.offset ?? 6)
    : binarize(gray, cutoff);

  const mask = opts.outline ? removeOutline(raw, w, h, opts.minStroke ?? 2) : raw;

  return { gray, raw, mask, cutoff, hash: frameHash(raw) };
}
