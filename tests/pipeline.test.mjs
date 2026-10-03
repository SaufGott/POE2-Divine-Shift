import test from 'node:test';
import assert from 'node:assert/strict';

import { toGray, frameHash } from '../src/pipeline/gray.js';
import { otsu, binarize, adaptiveBinarize } from '../src/pipeline/threshold.js';
import { removeOutline } from '../src/pipeline/outline.js';
import { segment } from '../src/pipeline/segment.js';
import { learn, classify, normalize } from '../src/pipeline/atlas.js';
import { recognizeLine } from '../src/pipeline/recognize.js';
import { processFrame } from '../src/pipeline/process.js';
import { ReadCache } from '../src/pipeline/cache.js';
import { stableRead } from '../src/pipeline/stability.js';
import { parseRatioLine } from '../src/parser.js';

/* A tiny 5x7 bitmap font stands in for the game font. */
const FONT = {
  '0': ['11111', '10001', '10001', '10001', '10001', '10001', '11111'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '00100'],
  '4': ['11111', '10001', '10001', '11111', '00001', '00001', '00001'],
  '5': ['11111', '10000', '10000', '11111', '00001', '00001', '11111'],
  '6': ['11111', '10000', '10000', '11111', '10001', '10001', '11111'],
  '8': ['11111', '10001', '10001', '11111', '10001', '10001', '11111'],
  // A period sits at the left of its advance and on the baseline, which is what
  // makes it tight against the digits — unlike the colon, which stands in space.
  '.': ['00000', '00000', '00000', '00000', '00000', '00000', '11000'],
  ':': ['00000', '00100', '00000', '00000', '00000', '00100', '00000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

/**
 * Render a string as a mask. `clean` is the glyph body; the returned `mask` is
 * what a camera sees: the body plus a 1 px outline ring.
 */
function renderLine(text, scale, pad = 2) {
  const chars = [...text].map((char) => FONT[char]);
  const gap = 2 * scale;
  const w = chars.length * (5 * scale + gap) + 2 * pad * scale;
  const h = 7 * scale + 2 * pad * scale;

  const clean = new Uint8Array(w * h);
  chars.forEach((pattern, ci) => {
    for (let y = 0; y < 7; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        if (pattern[y][x] !== '1') continue;
        for (let dy = 0; dy < scale; dy += 1) {
          for (let dx = 0; dx < scale; dx += 1) {
            clean[((y + pad) * scale + dy) * w + ((ci * (5 + gap / scale) + x + pad) * scale + dx)] = 1;
          }
        }
      }
    }
  });

  const outlined = Uint8Array.from(clean);
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x;
      if (!clean[i]) continue;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) outlined[(y + dy) * w + (x + dx)] = 1;
      }
    }
  }

  return { mask: outlined, clean, w, h };
}

/** An atlas built the way the live path uses it: from the unstripped mask. */
function trainAtlas(digits, scale = 4) {
  const atlas = {};

  for (const digit of digits) {
    const { mask, w, h } = renderLine(digit, scale);
    learn(atlas, digit, normalize(mask, w, h, segment(mask, w, h)[0]));
  }

  return atlas;
}

test('otsu separates a dark background from light glyphs', () => {
  const w = 40;
  const h = 20;
  const gray = new Uint8Array(w * h).fill(30);

  for (let y = 5; y < 15; y += 1) {
    for (let x = 10; x < 30; x += 1) gray[y * w + x] = 220;
  }

  const cutoff = otsu(gray);
  assert.ok(cutoff >= 30 && cutoff < 220, `otsu cutoff ${cutoff}`);

  const mask = binarize(gray, cutoff);
  assert.equal(mask[0], 0, 'background stays background');
  assert.equal(mask[10 * w + 15], 1, 'glyph block is detected');
});

test('adaptive threshold survives a lit gradient', () => {
  const w = 40;
  const h = 20;
  const gray = new Uint8Array(w * h);

  // Background ramps from 20 to 90 across the crop.
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) gray[y * w + x] = 20 + Math.round((x / w) * 70);
  }

  for (let y = 6; y < 14; y += 1) {
    for (let x = 12; x < 22; x += 1) gray[y * w + x] = 210;
  }

  const mask = adaptiveBinarize(gray, w, h, 15, 6);
  assert.equal(mask[6 * w + 15], 1, 'glyph detected on the lit side');
  assert.equal(mask[0], 0, 'background stays background');
});

test('outline ring is dropped, glyph body survives', () => {
  const { mask, clean, w, h } = renderLine('8', 4);

  const stripped = removeOutline(mask, w, h, 2);

  for (let i = 0; i < clean.length; i += 1) {
    assert.equal(stripped[i], clean[i], `pixel ${i} differs`);
  }
});

test('minStroke 1 keeps everything, minStroke 2 removes only the outer ring', () => {
  const { mask, clean, w, h } = renderLine('8', 1);

  const kept = removeOutline(mask, w, h, 1);
  for (let i = 0; i < mask.length; i += 1) {
    assert.equal(kept[i], mask[i], 'minStroke 1 is a no-op');
  }

  const stripped = removeOutline(mask, w, h, 2);

  let lost = 0;
  for (let i = 0; i < clean.length; i += 1) if (clean[i] && !stripped[i]) lost += 1;

  assert.equal(lost, 0, 'a body surrounded by a ring survives even at 1 px');
});

test('segmentation finds glyphs left-to-right and the colon as a separator', () => {
  const { mask, w, h } = renderLine('1:68', 4);
  const boxes = segment(mask, w, h);

  // The colon is two dots, so it is two separator components.
  assert.equal(boxes.length, 5, 'four glyphs plus the two colon dots');
  assert.deepEqual(boxes.map((b) => b.kind), ['glyph', 'separator', 'separator', 'glyph', 'glyph']);

  const xs = boxes.map((b) => b.x);
  assert.deepEqual(xs, [...xs].sort((a, b) => a - b), 'left-to-right order');
});

test('a decimal point is a dot, not a colon', () => {
  const { mask, w, h } = renderLine('4.5', 4);
  const boxes = segment(mask, w, h);

  assert.deepEqual(boxes.map((b) => b.kind), ['glyph', 'dot', 'glyph'], 'the period is its own component');

  const result = recognizeLine(mask, w, h, trainAtlas(['4', '5']));
  assert.ok(result.complete, 'both digits matched');
  assert.equal(result.text, '4.5', 'the line keeps its decimal point');
  assert.equal(parseRatioLine(result.text).toString(), '9/2', 'read as 4.5, not as 5/4');
});

test('a period below the digit area floor is still found', () => {
  const w = 40;
  const h = 12;
  const mask = new Uint8Array(w * h);

  // A full-height digit, then a 6 px period: under the digit floor, over the dot floor.
  for (let y = 2; y < 10; y += 1) for (let x = 2; x < 8; x += 1) mask[y * w + x] = 1;
  for (let y = 8; y < 10; y += 1) for (let x = 10; x < 13; x += 1) mask[y * w + x] = 1;

  const boxes = segment(mask, w, h);
  assert.equal(boxes.length, 2, 'the period survives the digit floor');
  assert.deepEqual(boxes.map((b) => b.kind), ['glyph', 'dot']);

  assert.equal(segment(mask, w, h, { minDotArea: 9 }).length, 1, 'under the dot floor it is dropped again');
});

test('a lone dot standing in whitespace is still the colon', () => {
  const { mask, w, h } = renderLine('1 . 5', 4);
  const boxes = segment(mask, w, h);

  assert.deepEqual(boxes.map((b) => b.kind), ['glyph', 'separator', 'glyph'], 'wide gaps on both sides');
  assert.equal(recognizeLine(mask, w, h, trainAtlas(['1', '5'])).text, '1 : 5');
});

test('a dot blob too tall for its width is the colon, not a period', () => {
  const w = 40;
  const h = 24;
  const mask = new Uint8Array(w * h);

  // A full-height digit, then a narrow blob sitting tight against it.
  for (let y = 2; y < 22; y += 1) for (let x = 2; x < 9; x += 1) mask[y * w + x] = 1;
  for (let y = 14; y < 22; y += 1) for (let x = 11; x < 12; x += 1) mask[y * w + x] = 1;

  const boxes = segment(mask, w, h);
  assert.deepEqual(boxes.map((b) => b.kind), ['glyph', 'separator'], '8 px tall on 1 px wide is two merged dots');
});

test('the atlas learns a digit and matches a noisy variant of it', () => {
  const { clean, w, h } = renderLine('8', 4);
  const box = segment(clean, w, h)[0];
  const atlas = {};

  learn(atlas, '8', normalize(clean, w, h, box));

  const noisy = Uint8Array.from(clean);
  noisy[2 * w + 2] = 0;
  noisy[5 * w + 3] = 1;

  const noisyBox = segment(noisy, w, h)[0];
  const best = classify(atlas, normalize(noisy, w, h, noisyBox), 0.8);

  assert.ok(best, 'matched');
  assert.equal(best.digit, '8');
  assert.ok(best.score > 0.8, `score ${best.score}`);
});

test('stable read needs N identical reads before accepting', () => {
  let previous = null;

  const first = stableRead(previous, '1 : 680', 3);
  assert.equal(first.streak, 1);
  assert.equal(first.accepted, false);

  const second = stableRead(first, '1 : 680', 3);
  assert.equal(second.streak, 2);
  assert.equal(second.accepted, false);

  const third = stableRead(second, '1 : 680', 3);
  assert.equal(third.streak, 3);
  assert.equal(third.accepted, true);

  const changed = stableRead(third, '1 : 681', 3);
  assert.equal(changed.streak, 1, 'a different read restarts the streak');
  assert.equal(changed.accepted, false);
});

test('end to end: outlined line is read without Tesseract', () => {
  const atlas = {};

  for (const digit of ['1', '6', '8', '0']) {
    const { clean, w, h } = renderLine(digit, 4);
    learn(atlas, digit, normalize(clean, w, h, segment(clean, w, h)[0]));
  }

  const { mask, w, h } = renderLine('1:680', 4);
  const stripped = removeOutline(mask, w, h, 2);
  const result = recognizeLine(stripped, w, h, atlas);

  assert.ok(result.complete, 'every glyph matched');
  assert.equal(result.text, '1 : 680');

  const parsed = parseRatioLine(result.text);
  assert.equal(parsed.toString(), '680', 'the line parses as 680 per 1');
});

test('frame hash is stable for identical crops and changes for different ones', () => {
  const a = new Uint8Array([1, 2, 3, 4]);
  const b = new Uint8Array([1, 2, 3, 4]);
  const c = new Uint8Array([1, 2, 3, 5]);

  assert.equal(frameHash(a), frameHash(b));
  assert.notEqual(frameHash(a), frameHash(c));
});

test('toGray stays inside 0-255', () => {
  const rgba = new Uint8Array([
    255, 255, 255, 255,
    0, 0, 0, 255,
    200, 200, 200, 255,
    255, 0, 0, 255,
    0, 0, 255, 255,
  ]);

  const gray = toGray(rgba, 5, 1);

  assert.deepEqual(Array.from(gray), [255, 0, 200, 76, 28]);
  for (const value of gray) assert.ok(value >= 0 && value <= 255);
});

test('processFrame recovers the glyph mask from a synthetic camera frame', () => {
  const { mask: seen, clean, w, h } = renderLine('8', 4);

  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < seen.length; i += 1) {
    const value = seen[i] ? 220 : 30;
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = value;
    rgba[i * 4 + 3] = 255;
  }

  const result = processFrame(rgba, w, h, { autoThreshold: true, outline: true, minStroke: 2 });

  for (let i = 0; i < clean.length; i += 1) {
    assert.equal(result.mask[i], clean[i], `pixel ${i} differs`);
  }
});

test('an unchanged crop returns the cached text instead of nothing', () => {
  const cache = new ReadCache();
  const hash = 12345;

  cache.set('region', hash, '1 : 680');

  const hit = cache.get('region', hash);
  assert.ok(hit, 'unchanged crop hits the cache');
  assert.equal(hit.text, '1 : 680');

  assert.equal(cache.get('region', 999), null, 'a changed crop misses the cache');
});

test('the atlas path sees the raw mask; only the Tesseract path strips outlines', () => {
  const { mask: seen, clean, w, h } = renderLine('8', 4);

  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < seen.length; i += 1) {
    const value = seen[i] ? 220 : 30;
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = value;
    rgba[i * 4 + 3] = 255;
  }

  const result = processFrame(rgba, w, h, { mode: 'otsu', outline: true, minStroke: 2 });

  assert.deepEqual(Array.from(result.raw), Array.from(seen), 'raw keeps the outline, as the training step does');
  assert.deepEqual(Array.from(result.mask), Array.from(clean), 'the stripped mask is still available for Tesseract');
  assert.notDeepEqual(Array.from(result.raw), Array.from(result.mask), 'the two paths really differ');
});
