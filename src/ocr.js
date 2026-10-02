/**
 * Client-side OCR: Tesseract.js against a local (offline) vendor bundle plus
 * game-screen capture via getDisplayMedia.
 *
 * Browser-only module. The image work itself lives in src/pipeline/* (pure and
 * testable); this file only moves pixels between the DOM and those functions.
 * Nothing here talks to a remote server: worker, WASM core and language data all
 * resolve to same-origin paths under vendor/. The Tesseract import is dynamic so
 * the dashboard still boots (manual entry) when vendor/ has not been fetched yet.
 */

import { processFrame } from './pipeline/process.js';
import { recognizeLine } from './pipeline/recognize.js';
import { ReadCache } from './pipeline/cache.js';

export const VENDOR = {
  workerPath: 'vendor/tesseract/worker.min.js',
  corePath: 'vendor/tesseract-core',
  langPath: 'vendor/lang',
  langFile: 'vendor/lang/eng.traineddata.gz',
};

// Single line of text. Not configurable from the UI: the app reads one line.
const PSM_SINGLE_LINE = 7;

async function loadTesseract() {
  const mod = await import('../vendor/tesseract/tesseract.esm.min.js');
  // The ESM bundle wraps the CommonJS module, so the API lives on `default`.
  return mod.default ?? mod;
}

export async function vendorAvailable() {
  try {
    const res = await fetch(VENDOR.langFile, { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;
  }
}

/** Draw a crop of the source canvas into a plain pixel buffer. */
export function cropToBuffer(sourceCanvas, rect, opts = {}) {
  const scale = opts.scale ?? 3;
  const pad = opts.pad ?? 2;

  const sx = Math.max(0, Math.round(rect.x) - pad);
  const sy = Math.max(0, Math.round(rect.y) - pad);
  const sw = Math.max(1, Math.round(rect.width) + pad * 2);
  const sh = Math.max(1, Math.round(rect.height) + pad * 2);

  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, w, h);

  return { canvas, ctx, image: ctx.getImageData(0, 0, w, h), w, h };
}

/**
 * Paint a binary mask as black text on white, which is what Tesseract expects.
 * The mask already separates glyph from background, so `invert` is only needed
 * when the crop is dark-on-light.
 */
export function paintMask(ctx, mask, w, h, invert = false) {
  const image = ctx.getImageData(0, 0, w, h);
  const d = image.data;

  for (let i = 0; i < mask.length; i += 1) {
    let v = mask[i] ? 0 : 255;
    if (invert) v = 255 - v;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  }

  ctx.putImageData(image, 0, 0);
}

export class OcrEngine {
  constructor(opts = {}) {
    this.opts = opts;
    this.worker = null;
    this.cache = new ReadCache();
  }

  async init(logger) {
    if (this.worker) return this.worker;

    const Tesseract = await loadTesseract();

    this.worker = await Tesseract.createWorker('eng', 1, {
      workerPath: this.opts.workerPath || VENDOR.workerPath,
      corePath: this.opts.corePath || VENDOR.corePath,
      langPath: this.opts.langPath || VENDOR.langPath,
      cacheMethod: 'write',
      logger: logger || (() => {}),
      errorHandler: (err) => console.error('[ocr]', err),
    });

    await this.worker.setParameters({
      // No character whitelist: the LSTM engine does not reliably honour it,
      // and the parser already normalises the digits.
      tessedit_pageseg_mode: Tesseract.PSM?.SINGLE_LINE ?? PSM_SINGLE_LINE,
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
    });

    return this.worker;
  }

  /**
   * Read one crop. The glyph atlas is tried first — for a fixed game font it is
   * more reliable than Tesseract and needs no worker. It matches against the raw
   * mask, because the training step never strips outlines. Tesseract is the
   * fallback while the atlas is incomplete, and that is where outline removal helps.
   */
  async recognizeRegion(sourceCanvas, rect, atlas, options = {}) {
    if (!this.worker) throw new Error('OCR worker not initialized');

    const { canvas, ctx, image, w, h } = cropToBuffer(sourceCanvas, rect, this.opts);
    const processed = processFrame(image.data, w, h, this.opts);

    const pipeline = atlas ? recognizeLine(processed.raw, w, h, atlas, this.opts) : null;

    if (pipeline && pipeline.complete) {
      return { text: pipeline.text, mask: processed.raw, w, h, glyphs: pipeline.glyphs, score: pipeline.score, method: 'atlas' };
    }

    const cached = this.cache.get(rect.id, processed.hash);
    if (!options.force && cached) {
      return { text: cached.text, mask: processed.raw, w, h, glyphs: pipeline?.glyphs || [], cached: true, method: 'cache' };
    }

    paintMask(ctx, processed.mask, w, h, this.opts.invert);
    const { data } = await this.worker.recognize(canvas);
    const text = (data?.text || '').trim();

    this.cache.set(rect.id, processed.hash, text);

    return { text, mask: processed.raw, w, h, glyphs: pipeline?.glyphs || [], method: 'tesseract' };
  }

  async close() {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
  }
}

/** Screen/window capture. Requires a secure context (localhost qualifies). */
export async function startDisplayMedia(videoEl) {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('getDisplayMedia is not available in this browser');
  }

  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 30 },
    audio: false,
  });

  videoEl.srcObject = stream;
  videoEl.muted = true;
  await videoEl.play();

  stream.getVideoTracks()[0]?.addEventListener('ended', () => {
    videoEl.srcObject = null;
  });

  return stream;
}

/** Draw the current live frame onto the preview canvas. Returns true if the canvas was resized. */
export function drawFrame(videoEl, canvasEl) {
  if (!videoEl.videoWidth) return false;

  let resized = false;
  if (canvasEl.width !== videoEl.videoWidth || canvasEl.height !== videoEl.videoHeight) {
    canvasEl.width = videoEl.videoWidth;
    canvasEl.height = videoEl.videoHeight;
    resized = true;
  }

  const ctx = canvasEl.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
  return resized;
}

/** Paste/drop a screenshot: draw it into the canvas for region OCR. */
export async function loadImageToCanvas(file, canvasEl) {
  const bitmap = await createImageBitmap(file);
  canvasEl.width = bitmap.width;
  canvasEl.height = bitmap.height;
  const ctx = canvasEl.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  return ctx;
}
