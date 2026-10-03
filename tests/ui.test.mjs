import test from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './dom-stub.mjs';

installDom();
const ui = await import('../src/ui.js');

import { makeRate, Rational } from '../src/math.js';

const LABELS = { c1: 'Div', c2: 'Ex', item: 'Omen' };

function makeState(overrides = {}) {
  return {
    labels: LABELS,
    rates: {
      r1: makeRate('Div', 'Ex', 48),
      r2: makeRate('Omen', 'Ex', '4.5'),
      r3: makeRate('Div', 'Omen', 10),
    },
    sources: { r1: 'manual', r2: 'manual', r3: 'manual' },
    step: '1',
    budget: 100,
    stableRead: { enabled: true, needed: 3 },
    ...overrides,
  };
}

test('the live read caps the streak at the number it needs and turns green on the hit', () => {
  const state = makeState();
  const root = document.createElement('div');

  ui.renderLive(state, root, { targetId: 'r1', text: '1 : 680', value: 680, streak: 12, score: 0.92 });

  const line = root.children[0];
  const stable = line.find('live-stable');
  assert.equal(stable.textContent, '3/3', 'never shows more than the number it needs');
  assert.ok(stable.className.includes('hit'), 'green when it reaches it');

  assert.equal(line.find('live-confidence').textContent, 'confidence 92%');
  assert.equal(line.find('live-value').textContent, '= 680');

  const second = document.createElement('div');
  ui.renderLive(state, second, { targetId: 'r1', text: '1 : 680', value: 680, streak: 2, score: 0 });

  const line2 = second.children[0];
  assert.equal(line2.find('live-stable').textContent, '2/3');
  assert.ok(!line2.find('live-stable').className.includes('hit'), 'not green before the hit');
  assert.equal(line2.find('live-confidence').textContent, 'confidence —');
});

test('the + and - buttons sit with the rate and call the handler with the right sign', () => {
  const state = makeState();
  const root = document.createElement('div');
  const calls = [];

  ui.renderRates(state, root, (pairId, sign) => calls.push([pairId, sign]), () => {});

  const row = root.find('rates-table').children[1];
  const ratio = row.find('ratio');
  const buttons = ratio.findAll('offset');

  assert.equal(buttons.length, 2, 'both buttons are inside the rate cell');
  assert.equal(buttons[0].textContent, '\u2212');
  assert.equal(buttons[1].textContent, '+');

  buttons[0].click();
  buttons[1].click();
  assert.deepEqual(calls, [['r1', -1], ['r1', 1]]);

  assert.ok(row.children[row.children.length - 1].className.includes('source'), 'source is the last cell');
});

test('the suggestion button appears only when a rate does not fit the budget', () => {
  const state = makeState({
    rates: {
      r1: makeRate('Div', 'Ex', 48),
      r2: makeRate('Omen', 'Ex', '4.67'),
      r3: makeRate('Div', 'Omen', 10),
    },
  });

  const root = document.createElement('div');
  const picked = [];
  ui.renderRates(state, root, () => {}, (pairId, value) => picked.push([pairId, value.toString()]));

  const fit = root.findDeep('fit');
  assert.ok(fit, 'a suggestion is offered for the row that does not fit');
  assert.equal(fit.textContent, '\u2192 4.68');

  fit.click();
  assert.deepEqual(picked, [['r2', '117/25']]);

  assert.ok(root.find('fit-note'), 'and the warning names the row');
  assert.ok(root.find('fit-note').textContent.includes('467'), 'it states the batch that is too big');
});

test('a rate that already fits gets no suggestion', () => {
  const root = document.createElement('div');
  ui.renderRates(makeState(), root, () => {}, () => {});

  assert.equal(root.find('fit-note'), null);
  assert.equal(root.findAllDeep('fit').length, 0);
});

test('the change column sits right after the rate column', () => {
  const state = makeState();
  const root = document.createElement('div');

  ui.renderRates(state, root, () => {}, () => {}, { r1: { from: '48', to: '49' } });

  const row = root.find('rates-table').children[1];
  const cells = row.children;

  assert.ok(cells[1].className.includes('ratio'), 'the rate column is second');
  assert.ok(cells[2].className.includes('change'), 'the change follows it');
  assert.equal(cells[2].textContent, '48 → 49');
  assert.ok(cells[3].className.includes('source'), 'source stays last');

  // A row that was not adjusted shows nothing.
  const other = root.find('rates-table').children[2];
  assert.equal(other.children[2].textContent, '');

  // The 1 is fixed: a rate is always per 1 reference item.
  const ratio = cells[1];
  assert.equal(ratio.find('fixed-one').textContent, '1');
  assert.equal(ratio.find('den-input'), null, 'the denominator is not an input any more');
  assert.equal(ratio.find('num-input').value, '48', 'the value input shows the rate as typed');
});

test('a stored num/den pair renders as the decimal it was read as', () => {
  const state = makeState({
    rates: {
      r1: makeRate('Div', 'Ex', 48, '1'),
      r2: makeRate('Omen', 'Ex', '5', '2'),
      r3: makeRate('Div', 'Omen', 10, '1'),
    },
  });

  const root = document.createElement('div');
  ui.renderRates(state, root, () => {}, () => {});

  const input = root.find('rates-table').children[2].findDeep('num-input');
  assert.equal(input.value, '2.5', 'the row shows 2.5, not its numerator 5');
  assert.equal(input.title, 'exact value 5/2');
});

test('the fit button replaces the entered value', () => {
  const state = makeState({
    rates: {
      r1: makeRate('Div', 'Ex', 48),
      r2: makeRate('Omen', 'Ex', '4.67'),
      r3: makeRate('Div', 'Omen', 10),
    },
  });

  const root = document.createElement('div');
  ui.renderRates(state, root, () => {}, (pairId, value) => {
    // Same shape as applySuggestion in src/main.js.
    state.rates[pairId] = { num: String(value.num), den: String(value.den) };
  });

  root.findDeep('fit').click();
  assert.equal(new Rational(state.rates.r2.num, state.rates.r2.den).toString(), '117/25', 'the entered value was replaced');
});
