import test from 'node:test';
import assert from 'node:assert/strict';

import { Rational, makeRate, analyzeBoth, analyzeCycle, percent } from '../src/math.js';
import { parseRatioLine, normalizeOcrDigits, parseManual } from '../src/parser.js';
import { buildPlaybook } from '../src/playbook.js';
import { DEFAULT_STATE } from '../src/storage.js';

const LABELS = { c1: 'Div', c2: 'Ex', item: 'Omen' };

const rates = {
  r1: makeRate('Div', 'Ex', 48),
  r2: makeRate('Omen', 'Ex', '4.5'),
  r3: makeRate('Div', 'Omen', 10),
};

test('decimal rates stay exact rationals', () => {
  assert.equal(new Rational('4.5').toString(), '9/2');
  assert.equal(new Rational(4.5).toString(), '9/2');
  assert.equal(new Rational('0.125').toString(), '1/8');
  assert.equal(parseManual('4.5', 1).toString(), '9/2');
});

test('forward cycle: factor, minimal integer batch and per-step amounts', () => {
  const { forward } = analyzeBoth(rates, LABELS);

  assert.equal(forward.factor.toString(), '16/15');
  assert.equal(forward.exactBatch, 15n);
  assert.deepEqual(
    forward.run.steps.map((s) => [String(s.in), String(s.out)]),
    [
      ['15', '720'],
      ['720', '160'],
      ['160', '16'],
    ],
  );
  assert.equal(forward.profit, 1n);
  assert.equal(forward.roi.toString(), '1/15');
  assert.equal(percent(forward.roi), '6.67');
  assert.ok(forward.profitable);
});

test('reverse direction is the mirror image and is flagged as a loss', () => {
  const { reverse } = analyzeBoth(rates, LABELS);
  assert.equal(reverse.factor.toString(), '15/16');
  assert.equal(reverse.exactBatch, 16n);
  assert.equal(reverse.profit, -1n);
  assert.ok(!reverse.profitable);
});

test('consistent rates produce no edge', () => {
  const flat = {
    r1: makeRate('Div', 'Ex', 1),
    r2: makeRate('Omen', 'Ex', 1),
    r3: makeRate('Div', 'Omen', 1),
  };
  const result = analyzeBoth(flat, LABELS);
  assert.equal(result.best.factor.toString(), '1');
  assert.equal(result.best.profit, 0n);
  assert.ok(!result.hasEdge);
});

test('zero rates are rejected', () => {
  assert.throws(() => makeRate('Div', 'Ex', 0), /zero/);
});

test('budget picks the largest multiple of the exact batch that fits', () => {
  const a = analyzeCycle(rates, 'forward', LABELS, { budget: 100 });
  assert.equal(a.plan.multiplier, 6n);
  assert.equal(a.batch, 90n);
  assert.equal(a.profit, 6n);
  assert.equal(a.plan.warning, null);

  const uncapped = analyzeCycle(rates, 'forward', LABELS, { budget: 0 });
  assert.equal(uncapped.batch, 15n);
  assert.equal(uncapped.plan.warning, null);
});

test('budget below one exact batch warns, and leftovers make a small batch usable', () => {
  const strict = analyzeCycle(rates, 'forward', LABELS, { budget: 10 });
  assert.ok(strict.plan.warning);
  assert.equal(strict.batch, 15n);

  const loose = analyzeCycle(rates, 'forward', LABELS, { budget: 10, allowRemainder: true });
  assert.equal(loose.batch, 10n);
  assert.equal(loose.run.steps[1].leftover, 3n);
  assert.equal(loose.run.steps[1].executed, 477n);
  assert.equal(loose.run.steps[1].out, 106n);
});

test('market line "1 : 680" parses as 680 per 1', () => {
  assert.equal(parseRatioLine('1 : 680').toString(), '680');
  assert.equal(parseRatioLine('1:680').toString(), '680');
  assert.equal(parseRatioLine('1 : 4S').toString(), '45');
  assert.equal(parseRatioLine('2 : 9').toString(), '9/2');
  assert.equal(parseRatioLine('48').toString(), '48');
  assert.equal(parseRatioLine('4,5').toString(), '9/2');
  assert.equal(parseRatioLine('no numbers here'), null);
  assert.equal(parseRatioLine('0 : 680'), null);
  assert.equal(normalizeOcrDigits('4S Div'), '45 Div');
});

test('leftovers are on by default, so integer rates do not force a huge batch', () => {
  assert.equal(DEFAULT_STATE.allowRemainder, true);

  const wide = {
    r1: makeRate('Div', 'Ex', 680),
    r2: makeRate('Omen', 'Ex', 450),
    r3: makeRate('Div', 'Omen', 1),
  };

  const exact = analyzeCycle(wide, 'forward', LABELS, { budget: 0, allowRemainder: false });
  assert.equal(exact.batch, 45n);

  const loose = analyzeCycle(wide, 'forward', LABELS, { budget: 1, allowRemainder: true });
  assert.equal(loose.batch, 1n);
  assert.equal(loose.run.steps[1].leftover, 230n);
});

test('playbook prints "Buy X for Y @ rate" lines and the net line', () => {
  const best = analyzeBoth(rates, LABELS).best;
  const playbook = buildPlaybook({ analysis: best, labels: LABELS });

  assert.equal(playbook.header.cycle, 'Div -> Ex -> Omen -> Div');
  assert.equal(playbook.header.batch, '15');
  assert.equal(playbook.steps[0].text, 'Step 1: Buy 720 Ex for 15 Div @ 48');
  assert.equal(playbook.steps[1].text, 'Step 2: Buy 160 Omen for 720 Ex @ 9/2');
  assert.equal(playbook.steps[2].text, 'Step 3: Buy 16 Div for 160 Omen @ 10');
  assert.equal(playbook.net.text, 'Net: +1 Div (6.67 %)');
});

test('leftovers are printed on the step that produces them', () => {
  const loose = analyzeCycle(rates, 'forward', LABELS, { budget: 10, allowRemainder: true });
  const playbook = buildPlaybook({ analysis: loose, labels: LABELS });

  assert.equal(playbook.steps[1].leftover, '3 Ex');
  assert.equal(playbook.steps[1].text, 'Step 2: Buy 106 Omen for 477 Ex @ 9/2 (leftover 3 Ex)');
  assert.equal(playbook.steps[0].leftover, null);
});

test('offsets apply exactly, including decimal rates like 4.5', () => {
  const rate = new Rational('4.5');
  assert.equal(rate.toString(), '9/2');
  assert.equal(rate.add(1).toString(), '11/2', 'overcut by one');
  assert.equal(rate.sub(1).toString(), '7/2', 'undercut by one');

  const step = parseManual('0.5');
  assert.equal(new Rational(680).add(step).toString(), '1361/2');
  assert.equal(new Rational(680).sub(step).toString(), '1359/2');

  assert.equal(new Rational(680).add(0).toString(), '680', 'a zero step changes nothing');
});
