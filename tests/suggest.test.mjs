import test from 'node:test';
import assert from 'node:assert/strict';

import { Rational, minimalBatch, buildLegs } from '../src/math.js';
import { nearestFittingRate, formatRate } from '../src/suggest.js';

const LABELS = { c1: 'Div', c2: 'Ex', item: 'Omen' };

const rates = {
  r1: new Rational(48),
  r2: new Rational('4.67'),
  r3: new Rational(10),
};

test('a rate that already fits the budget gets no suggestion', () => {
  assert.equal(nearestFittingRate(rates, 'r2', LABELS, 500), null);
  assert.equal(nearestFittingRate(rates, 'r2', LABELS, 0), null, 'budget 0 means no cap');
});

test('4.67 needs batch 467, so at budget 100 the nearest fitting ratio is 4.68', () => {
  assert.equal(minimalBatch(buildLegs(rates, 'forward', LABELS)), 467n);

  const suggestion = nearestFittingRate(rates, 'r2', LABELS, 100);
  assert.ok(suggestion, 'a suggestion is produced');
  assert.equal(suggestion.toString(), '117/25');
  assert.equal(formatRate(suggestion), '4.68');

  const test = { ...rates, r2: suggestion };
  assert.ok(minimalBatch(buildLegs(test, 'forward', LABELS)) <= 100n, 'the suggestion really fits');
  assert.ok(suggestion.sub(new Rational('4.67')).sign() > 0, 'and it is close to what was entered');
});

test('the closest fitting ratio wins, not the simplest one', () => {
  // 4.5 also fits at batch 15, but 4.68 is nearer to 4.67.
  const simpler = new Rational('4.5');
  assert.ok(minimalBatch(buildLegs({ ...rates, r2: simpler }, 'forward', LABELS)) <= 100n);
  assert.notEqual(nearestFittingRate(rates, 'r2', LABELS, 100).toString(), simpler.toString());
});

test('formatRate prints exact decimals', () => {
  assert.equal(formatRate(new Rational('4.67')), '4.67');
  assert.equal(formatRate(new Rational(47, 10)), '4.7');
  assert.equal(formatRate(new Rational(117, 25)), '4.68');
  assert.equal(formatRate(new Rational(9, 2)), '4.5');
  assert.equal(formatRate(new Rational(1, 2)), '0.5');
  assert.equal(formatRate(new Rational(680)), '680');
  assert.equal(formatRate(new Rational(7, 3)), '7/3', 'not exactly a decimal, so keep the ratio');
});
