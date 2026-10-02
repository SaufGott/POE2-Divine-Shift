import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_STATE, loadState, rememberRegionNorm, regionForFrame } from '../src/storage.js';

test('the stored state contains only what the app can change or read', () => {
  const keys = Object.keys(DEFAULT_STATE);
  for (const dead of ['captured', 'history', 'atlas']) {
    assert.ok(!keys.includes(dead), `${dead} is no longer used by anything`);
  }

  for (const setting of ['psm', 'minScore', 'minArea', 'atlasSize', 'tolerance']) {
    assert.ok(!DEFAULT_STATE.ocr[setting], `${setting} has no UI, so it is not persisted`);
  }

  // The defaults the pipeline still needs live in the pipeline modules themselves.
  assert.ok(DEFAULT_STATE.ocr.mode === 'otsu', 'threshold default stays');
  assert.ok(DEFAULT_STATE.ocr.scale === 3, 'capture scale default stays');
});

test('loadState returns the defaults when there is no localStorage', () => {
  const state = loadState();
  assert.deepEqual(state, DEFAULT_STATE);
});

test('the region is stored as fractions of the frame it was placed on', () => {
  const state = structuredClone(DEFAULT_STATE);
  state.frame = { w: 1000, h: 500 };
  state.region = { x: 100, y: 50, width: 100, height: 30, locked: false, norm: null };

  rememberRegionNorm(state);

  assert.deepEqual(state.region.norm, { x: 0.1, y: 0.1, w: 0.1, h: 0.06 });

  // Nothing to normalize against on a first run.
  const fresh = structuredClone(DEFAULT_STATE);
  rememberRegionNorm(fresh);
  assert.equal(fresh.region.norm, null);
});

test('a different frame size rebuilds the region from the stored fractions', () => {
  const state = structuredClone(DEFAULT_STATE);
  state.frame = { w: 1000, h: 500 };
  state.region = { x: 100, y: 50, width: 100, height: 30, locked: false, norm: null };
  rememberRegionNorm(state);

  const moved = regionForFrame(state, 1920, 1080);
  assert.ok(moved, 'the region is rebuilt');
  assert.deepEqual(state.frame, { w: 1920, h: 1080 });
  assert.equal(state.region.x, 192);
  assert.equal(state.region.y, 108);
  assert.equal(state.region.width, 192);
  assert.equal(state.region.height, 65);

  // A frame smaller than the region cannot hold it, so it is clamped.
  const small = structuredClone(state);
  regionForFrame(small, 120, 40);
  assert.ok(small.region.width <= 120 - small.region.x, 'width clamped to the frame');
  assert.ok(small.region.height <= 40 - small.region.y, 'height clamped to the frame');

  // Without stored fractions there is nothing to rebuild from.
  const plain = structuredClone(DEFAULT_STATE);
  assert.equal(regionForFrame(plain, 1920, 1080), false);
});
