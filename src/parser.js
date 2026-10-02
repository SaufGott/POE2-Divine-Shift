/**
 * OCR text -> exact ratio.
 *
 * The market UI shows one line per pair, e.g. "1 : 680": the first number is the
 * base unit, the second is the quote, so the rate is 680 quote per 1 base.
 * Pure module: no DOM, no dependencies.
 */

import { Rational } from './math.js';

const NUMBER_RE = /-?\d+(?:\.\d+)?/g;

/**
 * Fix the usual Tesseract confusions, but only inside tokens that already
 * contain a digit, so asset names (Div, Omen, Ex) survive.
 */
export function normalizeOcrDigits(text) {
  return String(text || '').replace(/[A-Za-z0-9]+/g, (token) => {
    if (!/\d/.test(token)) return token;
    return token
      .replace(/[Oo]/g, '0')
      .replace(/[lI]/g, '1')
      .replace(/[Ss]/g, '5')
      .replace(/[Bb]/g, '8')
      .replace(/[Tt]/g, '7')
      .replace(/[Zz]/g, '2');
  });
}

export function extractNumbers(text) {
  const clean = normalizeOcrDigits(text).replace(/(\d),(\d)/g, '$1.$2');
  return (clean.match(NUMBER_RE) || []).map((n) => new Rational(n));
}

/** "1 : 680" -> 680 (quote per base). A lone number is taken as the rate. */
export function parseRatioLine(text) {
  const numbers = extractNumbers(text);
  if (!numbers.length) return null;

  if (numbers.length >= 2) {
    if (numbers[0].isZero()) return null;
    return numbers[1].div(numbers[0]);
  }

  return numbers[0].isZero() ? null : numbers[0];
}

/** Manual entry: numerator/denominator (or a decimal) -> exact Rational. */
export function parseManual(numerator, denominator = 1) {
  const d = Rational.from(denominator);
  if (d.isZero()) throw new Error('denominator is zero');
  return Rational.from(numerator).div(d);
}
