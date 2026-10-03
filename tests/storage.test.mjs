import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_STATE,
  DEFAULT_PLACEMENTS,
  loadState,
  rememberPlacement,
  placementForFrame,
  saveState,
} from '../src/storage.js';

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

test('each pair has its own placement, at the positions that read reliably', () => {
  assert.deepEqual(DEFAULT_STATE.placements.r1, { x: 786, y: 551, width: 50, height: 30, norm: null });
  assert.deepEqual(DEFAULT_STATE.placements.r2, { x: 787, y: 551, width: 50, height: 30, norm: null });
  assert.deepEqual(DEFAULT_STATE.placements.r3, { x: 787, y: 551, width: 50, height: 30, norm: null });

  // One shared region is gone: the market UI shows a different row per pair.
  assert.ok(!('region' in DEFAULT_STATE), 'no single shared region');
});

test('loadState returns the defaults when there is no localStorage', () => {
  assert.deepEqual(loadState(), DEFAULT_STATE);
});

test('a placement is stored as fractions of the frame it was placed on', () => {
  const state = structuredClone(DEFAULT_STATE);
  state.frame = { w: 1000, h: 500 };

  rememberPlacement(state, 'r1');

  assert.deepEqual(state.placements.r1.norm, {
    x: 786 / 1000,
    y: 551 / 500,
    w: 50 / 1000,
    h: 30 / 500,
  });

  // Nothing to normalize against on a first run.
  const fresh = structuredClone(DEFAULT_STATE);
  rememberPlacement(fresh, 'r1');
  assert.equal(fresh.placements.r1.norm, null);
});

test('a different frame size rebuilds a placement from its stored fractions', () => {
  const state = structuredClone(DEFAULT_STATE);
  state.frame = { w: 1920, h: 1080 };
  rememberPlacement(state, 'r2');

  const moved = placementForFrame(state, 'r2', 1280, 720);
  assert.ok(moved, 'the placement is rebuilt');
  assert.deepEqual(state.frame, { w: 1280, h: 720 });
  assert.equal(state.placements.r2.x, 525);
  assert.equal(state.placements.r2.y, 367);
  assert.equal(state.placements.r2.width, 33);
  assert.equal(state.placements.r2.height, 20);

  // A frame smaller than the placement cannot hold it, so it is clamped.
  const small = structuredClone(state);
  placementForFrame(small, 'r2', 120, 40);
  assert.ok(small.placements.r2.width <= 120 - small.placements.r2.x, 'width clamped to the frame');
  assert.ok(small.placements.r2.height <= 40 - small.placements.r2.y, 'height clamped to the frame');

  // A default placement with no recorded frame is used as-is.
  const plain = structuredClone(DEFAULT_STATE);
  assert.equal(placementForFrame(plain, 'r3', 1920, 1080), false);
  assert.equal(plain.placements.r3.x, 787);
});

test('the active-pair alias is not written to storage twice', () => {
  const store = {};
  globalThis.localStorage = {
    getItem: (key) => store[key] ?? null,
    setItem: (key, value) => { store[key] = value; },
  };

  const state = structuredClone(DEFAULT_STATE);
  state.region = state.placements.r1;

  saveState(state);

  const saved = JSON.parse(store['poe2-arb-dashboard-v8']);
  assert.ok(!('region' in saved), 'the alias is not stored');
  assert.deepEqual(saved.placements.r1, { ...DEFAULT_PLACEMENTS.r1, norm: null });

  delete globalThis.localStorage;
});
