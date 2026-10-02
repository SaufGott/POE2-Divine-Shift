#!/usr/bin/env node
/**
 * One-time offline asset fetch for Tesseract.js.
 *
 * Downloads the worker script, all WASM core builds and the English language
 * data into ./vendor so the dashboard runs with no network at runtime.
 * Run once:  node scripts/fetch-vendor.mjs   (add --force to re-download)
 */

import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = path.join(ROOT, 'vendor');
const FORCE = process.argv.includes('--force');

const TESSERACT_VERSION = '7.0.0';
const CORE_VERSION = '7.0.0';
const LANG_VERSION = '1.0.0';

const CORE_FILES = [
  'tesseract-core.wasm.js',
  'tesseract-core-simd.wasm.js',
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-relaxedsimd.wasm.js',
  'tesseract-core-relaxedsimd-lstm.wasm.js',
];

const ASSETS = [
  { url: `https://cdn.jsdelivr.net/npm/tesseract.js@${TESSERACT_VERSION}/dist/worker.min.js`, out: 'tesseract/worker.min.js' },
  { url: `https://cdn.jsdelivr.net/npm/tesseract.js@${TESSERACT_VERSION}/dist/tesseract.esm.min.js`, out: 'tesseract/tesseract.esm.min.js' },
  ...CORE_FILES.map((f) => ({
    url: `https://cdn.jsdelivr.net/npm/tesseract.js-core@${CORE_VERSION}/${f}`,
    out: `tesseract-core/${f}`,
  })),
  {
    url: `https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@${LANG_VERSION}/4.0.0_best_int/eng.traineddata.gz`,
    out: 'lang/eng.traineddata.gz',
  },
];

async function fetchOne(asset) {
  const target = path.join(VENDOR, asset.out);
  await mkdir(path.dirname(target), { recursive: true });

  if (!FORCE) {
    try {
      const existing = await stat(target);
      if (existing.size > 0) {
        console.log(`skip  ${asset.out} (${existing.size} bytes, already present)`);
        return;
      }
    } catch {
      /* not there yet */
    }
  }

  const response = await fetch(asset.url);
  if (!response.ok) {
    throw new Error(`${asset.url} -> HTTP ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(target, buffer);
  console.log(`got   ${asset.out} (${buffer.length} bytes)`);
}

async function main() {
  console.log(`Fetching Tesseract.js assets into ${VENDOR}`);
  for (const asset of ASSETS) {
    await fetchOne(asset);
  }
  console.log('Done. The dashboard now runs fully offline (no CDN, no API).');
}

main().catch((error) => {
  console.error('fetch-vendor failed:', error.message);
  console.error('The app still works with manual entry; OCR needs these files.');
  process.exit(1);
});
