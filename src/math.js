/**
 * Exact rational arithmetic + triangular arbitrage engine.
 * Pure module: no DOM, no dependencies. Importable from browser and Node.
 *
 * Rate semantics: a Rate is "units of `quote` per 1 unit of `base`".
 *   r1 = C1 -> C2   (e.g. 1 Div = 48 Ex)
 *   r2 = Item -> C2 (e.g. 1 Omen = 4.5 Ex)
 *   r3 = C1 -> Item (e.g. 1 Div = 10 Omen)
 *
 * Forward cycle:  C1 -> C2 -> Item -> C1
 * Reverse cycle:  C1 -> Item -> C2 -> C1
 */

/* ------------------------------------------------------------------ */
/* Rational (BigInt backed)                                            */
/* ------------------------------------------------------------------ */

function abs(n) {
  return n < 0n ? -n : n;
}

export function gcd(a, b) {
  a = abs(BigInt(a));
  b = abs(BigInt(b));
  while (b !== 0n) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

/** Integer-only: bigint, integer number, or integer string. */
export function toBigInt(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`not a finite number: ${value}`);
    if (!Number.isInteger(value)) throw new Error(`not a whole number: ${value}`);
    return BigInt(value);
  }
  const s = String(value).trim();
  if (!/^-?\d+$/.test(s)) throw new Error(`not a whole number: ${value}`);
  return BigInt(s);
}

/** Exact num/den for a decimal literal: "4.5" -> { num: 45n, den: 10n }. */
export function decimalParts(value) {
  if (typeof value === 'bigint') return { num: value, den: 1n };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`not a finite number: ${value}`);
    if (Number.isInteger(value)) return { num: BigInt(value), den: 1n };
    return decimalParts(String(value));
  }
  const s = String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`not an exact decimal number: ${value}`);
  const negative = s.startsWith('-');
  const body = negative ? s.slice(1) : s;
  const [intPart, fracPart = ''] = body.split('.');
  const num = fracPart ? BigInt(intPart + fracPart) : BigInt(intPart);
  const den = fracPart ? 10n ** BigInt(fracPart.length) : 1n;
  return { num: negative ? -num : num, den };
}

export class Rational {
  constructor(num, den = 1n) {
    const p = decimalParts(num);
    const q = decimalParts(den);
    let n = p.num * q.den;
    let d = p.den * q.num;
    if (d === 0n) throw new Error('denominator is zero');
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const g = gcd(n, d);
    this.num = n / g;
    this.den = d / g;
  }

  static from(value) {
    return value instanceof Rational ? value : new Rational(value);
  }

  mul(other) {
    const o = Rational.from(other);
    return new Rational(this.num * o.num, this.den * o.den);
  }

  div(other) {
    const o = Rational.from(other);
    if (o.num === 0n) throw new Error('division by zero rate');
    return new Rational(this.num * o.den, this.den * o.num);
  }

  add(other) {
    const o = Rational.from(other);
    return new Rational(this.num * o.den + o.num * this.den, this.den * o.den);
  }

  sub(other) {
    const o = Rational.from(other);
    return new Rational(this.num * o.den - o.num * this.den, this.den * o.den);
  }

  isInteger() {
    return this.den === 1n;
  }

  isZero() {
    return this.num === 0n;
  }

  sign() {
    return this.num === 0n ? 0 : this.num > 0n ? 1 : -1;
  }

  cmp(other) {
    const o = Rational.from(other);
    const left = this.num * o.den;
    const right = o.num * this.den;
    return left === right ? 0 : left > right ? 1 : -1;
  }

  toNumber() {
    return Number(this.num) / Number(this.den);
  }

  toString() {
    return this.den === 1n ? String(this.num) : `${this.num}/${this.den}`;
  }
}

/* ------------------------------------------------------------------ */
/* Rates                                                               */
/* ------------------------------------------------------------------ */

/**
 * A rate is stored as a num/den pair, so both halves have to be honoured. Passing
 * the pair as three arguments silently dropped the denominator: a snapshot of 2.50
 * lands as { num: '5', den: '2' } and the row then showed 5.
 */
export function makeRate(base, quote, value, denominator = 1) {
  const d = Rational.from(denominator);
  if (d.isZero()) throw new Error(`rate ${base}->${quote} has a zero denominator`);

  const r = Rational.from(value).div(d);
  if (r.isZero()) throw new Error(`rate ${base}->${quote} is zero`);
  return { base, quote, value: r };
}

/** Accepts a Rate object or a bare Rational. */
function asRational(rate) {
  if (rate instanceof Rational) return rate;
  if (rate && rate.value instanceof Rational) return rate.value;
  return Rational.from(rate);
}

/**
 * Legs of the 3-step loop, each with an exact multiplier applied to the
 * amount carried through the cycle.
 */
export function buildLegs(rates, direction, labels) {
  const c1 = labels.c1;
  const c2 = labels.c2;
  const item = labels.item;

  const r1 = asRational(rates.r1);
  const r2 = asRational(rates.r2);
  const r3 = asRational(rates.r3);

  if (direction === 'forward') {
    return [
      { from: c1, to: c2, multiplier: r1, via: 'sell', rate: r1 },
      { from: c2, to: item, multiplier: new Rational(1).div(r2), via: 'buy', rate: r2 },
      { from: item, to: c1, multiplier: new Rational(1).div(r3), via: 'sell', rate: r3 },
    ];
  }

  return [
    { from: c1, to: item, multiplier: r3, via: 'buy', rate: r3 },
    { from: item, to: c2, multiplier: r2, via: 'sell', rate: r2 },
    { from: c2, to: c1, multiplier: new Rational(1).div(r1), via: 'buy', rate: r1 },
  ];
}

/**
 * Smallest positive integer batch (units of C1) that makes every step of the
 * loop an exact whole-number transaction.
 *
 * For each leg the carried amount must be divisible by the multiplier's
 * denominator; we grow the batch by the missing factor until all three steps
 * are integral. This is the LCM-style quantization the goal asks for
 * (1 item = 4.5 Ex -> 2 items = 9 Ex).
 */
export function minimalBatch(legs) {
  let batch = 1n;

  for (let guard = 0; guard < 64; guard += 1) {
    let amount = batch;
    let grew = false;

    for (const leg of legs) {
      const m = leg.multiplier;
      if (amount % m.den !== 0n) {
        const missing = m.den / gcd(amount, m.den);
        batch *= missing;
        grew = true;
        break;
      }
      amount = (amount * m.num) / m.den;
    }

    if (!grew) break;
  }

  return batch;
}

/**
 * Run the loop with a given batch.
 *
 * Exact mode (default): every step must be a whole number, so the batch has to
 * be a multiple of the minimal batch. With `allowRemainder`, each step trades
 * the largest whole multiple that fits and carries the rest as leftover — that
 * is what makes a batch of 1 usable when the rates are already integers.
 */
export function runCycle(legs, batch, options = {}) {
  const allowRemainder = options.allowRemainder ?? false;
  const steps = [];
  let amount = BigInt(batch);

  for (const leg of legs) {
    const m = leg.multiplier;
    let executed = amount;
    let leftover = 0n;

    if (amount % m.den !== 0n) {
      if (!allowRemainder) {
        throw new Error(`non-integer step: ${amount} * ${m} (${leg.from} -> ${leg.to})`);
      }
      leftover = amount % m.den;
      executed = amount - leftover;
    }

    const out = (executed * m.num) / m.den;
    steps.push({ ...leg, in: amount, executed, leftover, out });
    amount = out;
  }

  return { start: BigInt(batch), end: amount, steps };
}

/**
 * Budget: the most units of C1 the player can commit. The batch is the largest
 * multiple of the minimal exact batch that fits inside it. If the budget is
 * below one exact batch, a smaller batch is only usable with leftovers.
 */
export function planBatch(exactBatch, budget, allowRemainder = false) {
  const parts = decimalParts(budget);
  const cap = parts.num / parts.den;

  // Budget 0 means "no cap": use the minimal exact batch.
  if (cap === 0n) {
    return { budget: 0n, exactBatch, multiplier: 1n, batch: exactBatch, warning: null };
  }

  if (cap >= exactBatch) {
    const multiplier = cap / exactBatch;
    return { budget: cap, exactBatch, multiplier, batch: exactBatch * multiplier, warning: null };
  }

  if (allowRemainder && cap > 0n) {
    return {
      budget: cap,
      exactBatch,
      multiplier: 0n,
      batch: cap,
      warning: `budget ${cap} is below one exact batch (${exactBatch}) — steps run with leftovers`,
    };
  }

  return {
    budget: cap,
    exactBatch,
    multiplier: 0n,
    batch: exactBatch,
    warning: `budget ${cap} is below one exact batch (${exactBatch})`,
  };
}

/** Full analysis of one direction. */
export function analyzeCycle(rates, direction, labels, options = {}) {
  const legs = buildLegs(rates, direction, labels);
  const factor = legs.reduce((acc, leg) => acc.mul(leg.multiplier), new Rational(1));
  const exactBatch = minimalBatch(legs);
  const plan = planBatch(exactBatch, options.budget ?? exactBatch, options.allowRemainder);
  const batch = plan.batch;
  const run = runCycle(legs, batch, { allowRemainder: options.allowRemainder });
  const profit = run.end - run.start;
  const roi = new Rational(profit).div(batch);

  return {
    direction,
    legs,
    factor,
    exactBatch,
    plan,
    batch,
    run,
    profit,
    roi,
    profitable: factor.cmp(1) > 0,
    allowRemainder: options.allowRemainder ?? false,
  };
}

/** Both directions; `best` is the profitable one (or null when there is no edge). */
export function analyzeBoth(rates, labels, options = {}) {
  const forward = analyzeCycle(rates, 'forward', labels, options);
  const reverse = analyzeCycle(rates, 'reverse', labels, options);
  const best = forward.factor.cmp(reverse.factor) >= 0 ? forward : reverse;
  return {
    forward,
    reverse,
    best,
    hasEdge: best.factor.cmp(1) > 0,
  };
}

/* ------------------------------------------------------------------ */
/* Formatting helpers (used by the UI and the playbook)                */
/* ------------------------------------------------------------------ */

export function percent(value, digits = 2) {
  return (value.toNumber() * 100).toFixed(digits);
}
