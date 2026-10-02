import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';

import { readPng } from '../src/pipeline/png.js';
import { glyphFromImage, digitFromPath } from '../src/pipeline/train.js';
import { matchScoreTolerant, matchScore, normalize, encode, decode, learn, classify, mergeAtlas, ATLAS_SIZE } from '../src/pipeline/atlas.js';

/* ------------------------------------------------------------------ */
/* Minimal PNG writer, so the reader can be tested against real files   */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const name = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([length, name, data, crc]);
}

function png({ width, height, colorType, scanlines, palette }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;

  const raw = Buffer.concat(scanlines);
  const parts = [Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr)];
  if (palette) parts.push(chunk('PLTE', palette));
  parts.push(chunk('IDAT', zlib.deflateSync(raw)));
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const BACKGROUND = 30;
const INK = 220;

const ONE = ['.#.', '###', '.#.', '.#.', '.#.'];
const ZERO = ['.###.', '#...#', '#...#', '#...#', '.###.'];

function render(rows, scale, { noise = [] } = {}) {
  const h = rows.length * scale;
  const w = rows[0].length * scale;
  const gray = new Uint8Array(w * h).fill(BACKGROUND);

  for (let y = 0; y < rows.length; y += 1) {
    for (let x = 0; x < rows[y].length; x += 1) {
      if (rows[y][x] === '#') {
        for (let dy = 0; dy < scale; dy += 1) {
          for (let dx = 0; dx < scale; dx += 1) {
            gray[((y * scale + dy) * w) + (x * scale + dx)] = INK;
          }
        }
      }
    }
  }

  for (const [x, y] of noise) gray[y * w + x] = INK;
  return { w, h, gray };
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

test('readPng decodes a grayscale PNG', () => {
  const image = render(ONE, 2);
  const scanlines = [];
  for (let y = 0; y < image.h; y += 1) {
    scanlines.push(Buffer.from([0, ...image.gray.subarray(y * image.w, (y + 1) * image.w)]));
  }

  const buffer = png({ width: image.w, height: image.h, colorType: 0, scanlines });
  const decoded = readPng(buffer);

  assert.equal(decoded.w, image.w);
  assert.equal(decoded.h, image.h);
  assert.deepEqual(Array.from(decoded.gray), Array.from(image.gray));
});

test('readPng applies the up filter', () => {
  const image = render(ONE, 2);
  const scanlines = [];

  for (let y = 0; y < image.h; y += 1) {
    const row = [2];
    for (let x = 0; x < image.w; x += 1) {
      const value = image.gray[y * image.w + x];
      const above = y > 0 ? image.gray[(y - 1) * image.w + x] : 0;
      row.push((value - above) & 255);
    }
    scanlines.push(Buffer.from(row));
  }

  const buffer = png({ width: image.w, height: image.h, colorType: 0, scanlines });
  assert.deepEqual(Array.from(readPng(buffer).gray), Array.from(image.gray));
});

test('readPng maps palette indices through PLTE', () => {
  const palette = Buffer.from([10, 10, 10, 200, 200, 200]);
  const rows = ['..##.', '.#..#', '#....'];
  const w = rows[0].length;
  const h = rows.length;

  const scanlines = [];
  for (let y = 0; y < h; y += 1) {
    const row = [0];
    for (let x = 0; x < w; x += 1) row.push(rows[y][x] === '#' ? 1 : 0);
    scanlines.push(Buffer.from(row));
  }

  const buffer = png({ width: w, height: h, colorType: 3, scanlines, palette });
  const decoded = readPng(buffer);

  assert.equal(decoded.gray[0], (10 * 77 + 10 * 150 + 10 * 29) >> 8);
  assert.equal(decoded.gray[2], (200 * 77 + 200 * 150 + 200 * 29) >> 8);
  assert.equal(decoded.gray[2], 200);
});

test('readPng decodes an RGBA image pixel by pixel, not byte by byte', () => {
  const rows = ['##.', '#..', '##.'];
  const w = rows[0].length;
  const h = rows.length;

  const scanlines = [];
  for (let y = 0; y < h; y += 1) {
    const row = [0];
    for (let x = 0; x < w; x += 1) {
      const on = rows[y][x] === '#';
      row.push(on ? 255 : 0, on ? 0 : 0, on ? 0 : 0, 255);
    }
    scanlines.push(Buffer.from(row));
  }

  const buffer = png({ width: w, height: h, colorType: 6, scanlines });
  const decoded = readPng(buffer);

  // Pure red maps to 76 (255 * 77 >> 8), not to the green or blue byte of the
  // previous pixel.
  assert.deepEqual(Array.from(decoded.gray), [76, 76, 0, 76, 0, 0, 76, 76, 0]);
});

test('readPng rejects files it cannot read', () => {
  assert.throws(() => readPng(Buffer.from('not a png')), /not a PNG/);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 16;
  ihdr[9] = 0;

  const buffer = Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);

  assert.throws(() => readPng(buffer), /bit depth/);
});

test('glyphFromImage recovers the glyph and ignores the background', () => {
  const image = render(ONE, 3);
  const glyph = glyphFromImage(image.gray, image.w, image.h);

  assert.ok(glyph);
  assert.equal(glyph.bitmap.length, ATLAS_SIZE * ATLAS_SIZE);
  assert.ok(glyph.bitmap.reduce((sum, value) => sum + value, 0) > 0);
  assert.equal(glyph.hex, encode(glyph.bitmap));
});

test('glyphFromImage returns null when there is nothing to learn', () => {
  const empty = new Uint8Array(20 * 20).fill(BACKGROUND);
  assert.equal(glyphFromImage(empty, 20, 20), null);
});

function shift(bitmap, dx, dy, size = ATLAS_SIZE) {
  const out = new Uint8Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!bitmap[y * size + x]) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < size && ny >= 0 && ny < size) out[ny * size + nx] = 1;
    }
  }
  return out;
}

test('tolerant matching survives a one-pixel shift that exact matching fails', () => {
  const template = glyphFromImage(...spread(render(ONE, 3))).bitmap;
  const shifted = shift(template, 1, 0);

  assert.ok(matchScoreTolerant(template, shifted, 1) >= 0.95);
  assert.ok(matchScore(template, shifted) < 0.95);
  assert.ok(matchScoreTolerant(template, shifted, 1) > matchScore(template, shifted));

  // A genuinely different digit still does not match.
  const other = glyphFromImage(...spread(render(ZERO, 3)));
  assert.ok(matchScoreTolerant(template, other, 1) < 0.9);
});

test('digitFromPath reads the digit from the folder or the filename', () => {
  assert.equal(digitFromPath('0.png'), '0');
  assert.equal(digitFromPath('9.png'), '9');
  assert.equal(digitFromPath('3/2.png'), '3');
  assert.equal(digitFromPath('7/sample-1.png'), '7');
  assert.equal(digitFromPath('atlas.json'), null);
  assert.equal(digitFromPath('notes/readme.png'), null);
});

test('the trained base and runtime samples are used together', () => {
  const base = { '1': [glyphFromImage(...spread(render(ONE, 3))).hex] };
  const runtime = { '0': [glyphFromImage(...spread(render(ZERO, 3))).hex] };

  const merged = mergeAtlas(base, runtime);
  assert.deepEqual(Object.keys(merged).sort(), ['0', '1']);

  const mergedAgain = mergeAtlas(base, { '1': merged['1'] });
  assert.equal(mergedAgain['1'].length, base['1'].length);

  // A shifted read is classified through the base template, with tolerance.
  const read = shift(glyphFromImage(...spread(render(ONE, 3))).bitmap, 1, 0);
  const hit = classify(merged, read, 0.95);
  assert.equal(hit.digit, '1');

  learn(merged, '5', glyphFromImage(...spread(render(ZERO, 3))).bitmap);
  assert.ok(merged['5'].length === 1);
});

function spread(image) {
  return [image.gray, image.w, image.h];
}

function decodeRoundTrip(hex) {
  return decode(hex);
}

test('atlas entries survive the JSON round-trip', () => {
  const bitmap = glyphFromImage(...spread(render(ONE, 3))).bitmap;
  const hex = encode(bitmap);
  assert.deepEqual(Array.from(decodeRoundTrip(hex)), Array.from(bitmap));
});
