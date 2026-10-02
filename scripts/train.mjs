#!/usr/bin/env node
/**
 * Train the glyph atlas from screenshots.
 *
 * Put one PNG per digit in ./training:
 *
 *   training/0.png ... training/9.png
 *   training/3/2.png        (extra samples for a digit go in its folder)
 *
 * Rules for a crop: native resolution, no resizing, tight around one glyph with
 * at least 3 px of untouched game background around it, same font size as the live
 * capture region. The outline stays part of the shape on purpose.
 *
 * Writes training/atlas.json, which the dashboard loads at boot. Runtime learning
 * adds samples on top; Reset clears those but not this file.
 *
 *   node scripts/train.mjs
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readPng } from '../src/pipeline/png.js';
import { glyphFromImage, digitFromPath } from '../src/pipeline/train.js';
import { ATLAS_SIZE } from '../src/pipeline/atlas.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Optional argument: train from another folder (used by the tests).
const TRAINING = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'training');

async function walk(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await walk(full));
    else if (entry.name.toLowerCase().endsWith('.png')) found.push(full);
  }
  return found.sort();
}

async function main() {
  let files;
  try {
    files = await walk(TRAINING);
  } catch (error) {
    console.error(`No training folder: ${TRAINING}`);
    console.error('Put one PNG per digit in it, then run this script again.');
    process.exit(1);
  }

  if (!files.length) {
    console.error(`Nothing to train in ${TRAINING}. Add training/0.png ... training/9.png.`);
    process.exit(1);
  }

  const atlas = {};
  const report = [];

  for (const file of files) {
    const relative = path.relative(TRAINING, file).replaceAll(path.sep, '/');
    const digit = digitFromPath(relative);

    if (!digit) {
      report.push({ file: relative, error: 'path does not start with a digit' });
      continue;
    }

    let image;
    try {
      image = readPng(await readFile(file));
    } catch (error) {
      report.push({ file: relative, digit, error: error.message });
      continue;
    }

    const glyph = glyphFromImage(image.gray, image.w, image.h);

    if (!glyph) {
      report.push({ file: relative, digit, error: 'no glyph found (crop is empty, all background, or smaller than 12 px)' });
      continue;
    }

    const warnings = [];
    const shapes = (glyph.components || []).filter((box) => box.kind === 'glyph');

    if (shapes.length > 1) warnings.push(`${shapes.length} separate shapes in the crop, expected 1`);
    if (glyph.box.h / glyph.box.w > 3) {
      warnings.push(`shape is ${glyph.box.w}x${glyph.box.h}, too tall and narrow to be one digit`);
    }

    atlas[digit] = [...(atlas[digit] || []), glyph.hex];
    report.push({ file: relative, digit, samples: 1, size: `${image.w}x${image.h}`, glyph: `${glyph.box.w}x${glyph.box.h}`, warnings });
  }

  const digits = {};
  for (const digit of Object.keys(atlas).sort()) {
    digits[digit] = [...new Set(atlas[digit])].slice(0, 5);
  }

  const output = {
    generatedAt: new Date().toISOString(),
    size: ATLAS_SIZE,
    digits,
    report,
  };

  await writeFile(path.join(TRAINING, 'atlas.json'), `${JSON.stringify(output, null, 2)}\n`);

  console.log(`Trained ${Object.keys(digits).length} / 10 digits into ${path.relative(ROOT, path.join(TRAINING, 'atlas.json'))}\n`);

  for (let digit = 0; digit <= 9; digit += 1) {
    const samples = digits[String(digit)];
    console.log(`  ${digit}  ${samples ? `${samples.length} sample(s)` : 'MISSING'}`);
  }

  const flagged = report.filter((entry) => entry.warnings && entry.warnings.length);
  if (flagged.length) {
    console.log('\nSuspicious crops:');
    for (const entry of flagged) console.log(`  ${entry.file}: ${entry.warnings.join('; ')}`);
    console.log('These were still trained, but they are probably not single glyphs.');
    console.log();
  }

  const failures = report.filter((entry) => entry.error);
  if (failures.length) {
    console.log('\nProblems:');
    for (const failure of failures) console.log(`  ${failure.file}: ${failure.error}`);
    console.log('\nRe-crop those and run again. The dashboard loads whatever is here now.');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('training failed:', error.message);
  process.exit(1);
});
