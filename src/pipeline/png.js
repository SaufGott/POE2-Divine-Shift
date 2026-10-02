/**
 * Minimal PNG reader, no dependencies.
 *
 * Only what the training step needs: 8-bit, non-interlaced PNGs, colour types
 * 0 (gray), 2 (RGB), 3 (palette), 4 (gray+alpha) and 6 (RGBA). Returns a luma
 * buffer in the same layout the rest of the pipeline expects.
 */

import zlib from 'node:zlib';

const SIGNATURE = '89504e470d0a1a0a';
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

// Same coefficients as pipeline/gray.js: they must sum to 256 for a shift of 8.
function luma(r, g, b) {
  return (r * 77 + g * 150 + b * 29) >> 8;
}

/** Parse chunks into a map of type -> concatenated data. */
function chunks(buffer) {
  const out = {};
  let offset = 8;

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    out[type] = Buffer.concat([out[type] || Buffer.alloc(0), buffer.subarray(offset + 8, offset + 8 + length)]);
    offset += 12 + length;
  }

  return out;
}

export function readPng(buffer) {
  if (buffer.subarray(0, 8).toString('hex') !== SIGNATURE) {
    throw new Error('not a PNG file');
  }

  const parts = chunks(buffer);
  if (!parts.IHDR) throw new Error('PNG has no IHDR chunk');

  const ihdr = parts.IHDR;
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const depth = ihdr[8];
  const colorType = ihdr[9];
  const interlace = ihdr[12];

  if (depth !== 8) throw new Error(`unsupported bit depth ${depth} (only 8-bit PNGs are read)`);
  if (interlace !== 0) throw new Error('interlaced PNGs are not supported');
  if (!(colorType in CHANNELS)) throw new Error(`unsupported colour type ${colorType}`);
  if (!parts.IDAT) throw new Error('PNG has no IDAT chunk');

  const channels = CHANNELS[colorType];
  const stride = width * channels;
  const raw = zlib.inflateSync(Buffer.concat([parts.IDAT]));

  if (raw.length < height * (stride + 1)) {
    throw new Error(`IDAT is shorter than the image (${raw.length} bytes for ${width}x${height})`);
  }

  // Unfiltered scanlines. For palette images the values are palette indices, so
  // the filter is applied on the index, which is how PNG defines it.
  const samples = new Uint8Array(width * height * channels);
  let pos = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos];
    pos += 1;

    for (let x = 0; x < stride; x += 1) {
      const value = raw[pos];
      pos += 1;

      const left = x >= channels ? samples[y * stride + x - channels] : 0;
      const up = y > 0 ? samples[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? samples[(y - 1) * stride + x - channels] : 0;

      let v = value;
      if (filter === 1) v = (value + left) & 255;
      else if (filter === 2) v = (value + up) & 255;
      else if (filter === 3) v = (value + ((left + up) >> 1)) & 255;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        const pred = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        v = (value + pred) & 255;
      }

      samples[y * stride + x] = v & 255;
    }
  }

  const gray = new Uint8Array(width * height);
  const palette = parts.PLTE;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // x is a pixel index; samples is indexed by byte offset within the row.
      const at = y * stride + x * channels;

      if (colorType === 3) {
        if (!palette) throw new Error('palette PNG has no PLTE chunk');
        const index = samples[at] * 3;
        gray[y * width + x] = luma(palette[index], palette[index + 1], palette[index + 2]);
      } else if (colorType === 0) {
        gray[y * width + x] = samples[at];
      } else if (colorType === 4) {
        gray[y * width + x] = samples[at];
      } else {
        gray[y * width + x] = luma(samples[at], samples[at + 1], samples[at + 2]);
      }
    }
  }

  return { w: width, h: height, gray };
}
