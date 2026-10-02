/**
 * Suggest a nearby rate that keeps the exact batch inside the budget.
 *
 * A rate like 4.67 is 467/100, so the exact batch needs a large number of C1
 * before every step is a whole number — you would have to trade a huge volume to
 * keep everything integral. When the budget cannot cover that, the practical
 * answer is the closest rate with a smaller denominator that does fit.
 *
 * Search denominators from 1 upward, take the nearest numerator for each, and
 * keep the candidates whose batch fits the budget. Among those, return the closest
 * to what was entered; on an equal distance prefer the simpler ratio.
 *
 * Pure module: no DOM, no dependencies.
 */

import { Rational, buildLegs, minimalBatch, decimalParts } from './math.js';

function abs(n) {
  return n < 0n ? -n : n;
}

/** round(value * den) with BigInt, half away from zero. */
function roundProduct(value, den) {
  const num = value.num * den;
  const negative = num < 0n;
  const magnitude = negative ? -num : num;
  const quotient = magnitude / value.den;
  const remainder = magnitude % value.den;
  const rounded = remainder * 2n >= value.den ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/** Display a rational the way a person would type it: 4.7, not 47/10. */
export function formatRate(value) {
  const r = Rational.from(value);
  const sign = r.num < 0n ? '-' : '';
  const num = abs(r.num);
  const den = abs(r.den);

  if (den === 1n) return `${sign}${num}`;

  // Exactly representable as a decimal when the denominator has only factors 2 and 5.
  let rest = den;
  let twos = 0;
  let fives = 0;
  while (rest % 2n === 0n) { rest /= 2n; twos += 1; }
  while (rest % 5n === 0n) { rest /= 5n; fives += 1; }
  if (rest !== 1n) return r.toString();

  const places = Math.max(twos, fives);
  const scaled = (num * 10n ** BigInt(places)) / den;
  const digits = String(scaled).padStart(places + 1, '0');

  return `${sign}${digits.slice(0, digits.length - places)}.${digits.slice(digits.length - places)}`;
}

/**
 * Returns the closest fitting Rational, or null when the entered rate already fits
 * or the budget is uncapped (budget 0 means "no cap").
 */
export function nearestFittingRate(rates, pairId, labels, budget, options = {}) {
  const maxDen = BigInt(options.maxDenominator ?? 200);
  const current = Rational.from(rates[pairId]);
  const parts = decimalParts(budget);
  const cap = parts.num / parts.den;

  if (cap === 0n || current.isZero()) return null;

  const asMap = {};
  for (const key of ['r1', 'r2', 'r3']) asMap[key] = Rational.from(rates[key]);

  const fits = (candidate) => {
    if (candidate.isZero()) return false;
    const test = { ...asMap, [pairId]: candidate };
    for (const direction of ['forward', 'reverse']) {
      if (minimalBatch(buildLegs(test, direction, labels)) <= cap) return true;
    }
    return false;
  };

  if (fits(current)) return null;

  let best = null;
  let bestDistance = 0n;

  for (let den = 1n; den <= maxDen; den += 1n) {
    const candidate = new Rational(roundProduct(current, den), den);
    if (candidate.isZero() || !fits(candidate)) continue;

    const distance = abs(current.sub(candidate));
    if (!best || distance < bestDistance || (distance === bestDistance && candidate.den < best.den)) {
      best = candidate;
      bestDistance = distance;
    }
  }

  return best;
}
