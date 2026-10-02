/**
 * Line recognition from a binary mask: segment, classify each glyph against the
 * learned atlas, rebuild the line.
 *
 * `complete` is false when any glyph could not be matched, which is the signal to
 * fall back to Tesseract. The score is our own confidence — the vendored
 * Tesseract bundle is text-only and exposes none.
 */

import { segment } from './segment.js';
import { classify, normalize } from './atlas.js';

export function recognizeLine(mask, w, h, atlas, opts = {}) {
  const size = opts.atlasSize;
  const minScore = opts.minScore ?? 0.8;

  const boxes = segment(mask, w, h, opts);
  const glyphs = [];

  let classified = 0;
  let totalScore = 0;

  for (const box of boxes) {
    if (box.kind === 'separator') {
      glyphs.push({ char: ':', kind: 'separator', box });
      continue;
    }

    const bitmap = normalize(mask, w, h, box, size);
    const best = classify(atlas, bitmap, minScore, size, opts.tolerance ?? 1);

    if (!best) {
      glyphs.push({ char: '?', kind: 'glyph', bitmap, box });
      continue;
    }

    classified += 1;
    totalScore += best.score;
    glyphs.push({ char: best.digit, kind: 'glyph', bitmap, box, score: best.score });
  }

  const glyphCount = glyphs.filter((glyph) => glyph.kind === 'glyph').length;

  // A colon is two dots, so it arrives as two separator components. Collapse them
  // so the rebuilt line is "1 : 680", not "1 : : 680".
  const text = glyphs
    .filter((glyph, index) => {
      if (glyph.kind !== 'separator') return true;
      return index === 0 || glyphs[index - 1].kind !== 'separator';
    })
    .map((glyph) => (glyph.kind === 'separator' ? ' : ' : glyph.char))
    .join('');

  return {
    text,
    glyphs,
    complete: glyphCount > 0 && classified === glyphCount,
    score: classified ? totalScore / classified : 0,
  };
}
