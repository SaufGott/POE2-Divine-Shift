/**
 * Turn one cropped glyph image into an atlas bitmap.
 *
 * Pure: it takes a luma buffer, so it is testable in Node without a filesystem.
 * The outline is deliberately NOT stripped here — for a fixed game font the outline
 * is part of the shape, and stripping it can eat a thin stroke.
 */

import { otsu, binarize } from './threshold.js';
import { segment } from './segment.js';
import { normalize, encode, ATLAS_SIZE } from './atlas.js';

/** training/0.png -> '0'; training/3/2.png -> '3'. */
export function digitFromPath(relative) {
  const first = String(relative).split('/')[0];
  const stem = first.includes('.') ? first.slice(0, first.indexOf('.')) : first;
  return /^\d$/.test(stem) ? stem : null;
}

export function glyphFromImage(gray, w, h, opts = {}) {
  const mask = binarize(gray, otsu(gray));
  const boxes = segment(mask, w, h, { minArea: opts.minArea ?? 12 });

  const glyphs = boxes
    .filter((box) => box.kind === 'glyph')
    .sort((a, b) => b.w * b.h - a.w * a.h);

  if (!glyphs.length) return null;

  const box = glyphs[0];

  return {
    bitmap: normalize(mask, w, h, box, opts.atlasSize ?? ATLAS_SIZE),
    hex: encode(normalize(mask, w, h, box, opts.atlasSize ?? ATLAS_SIZE)),
    box,
    components: boxes,
    mask,
  };
}
