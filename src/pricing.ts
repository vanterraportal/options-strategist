/**
 * Indicative option pricing: Black-Scholes on a real spot price with an
 * indicative volatility (for example 30-day realised volatility plus a simple smile). Nothing here is a
 * tradable quote: label these numbers as indicative wherever you show them.
 */

export type OptionType = "call" | "put";

/** Risk-free rate assumption for indicative pricing, shown in the methodology note. */
export const RATE = 0.04;
/** Volatility used when realised volatility could not be computed. Callers may label it as a default. */
export const FALLBACK_VOL = 0.35;
const YEAR_MS = 365 * 24 * 3600 * 1000;

const SQRT2PI = Math.sqrt(2 * Math.PI);
export const normPdf = (x: number) => Math.exp(-0.5 * x * x) / SQRT2PI;

/** Abramowitz-Stegun 7.1.26, max error ~1.5e-7. */
export function normCdf(x: number) {
  const t = 1 / (1 + (0.3275911 * Math.abs(x)) / Math.SQRT2);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

export type Greeks = {
  price: number;
  delta: number;
  gamma: number;
  /** Per calendar day. */
  theta: number;
  /** Per 1 volatility point (0.01). */
  vega: number;
};

export function blackScholes(type: OptionType, S: number, K: number, T: number, sigma: number, r = RATE): Greeks {
  if (T <= 1e-6 || sigma <= 0) {
    const intrinsic = type === "call" ? Math.max(S - K, 0) : Math.max(K - S, 0);
    const itm = type === "call" ? S > K : S < K;
    return { price: intrinsic, delta: itm ? (type === "call" ? 1 : -1) : 0, gamma: 0, theta: 0, vega: 0 };
  }
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const disc = Math.exp(-r * T);
  const pdf = normPdf(d1);
  const gamma = pdf / (S * sigma * sqrtT);
  const vega = (S * pdf * sqrtT) / 100;
  if (type === "call") {
    const price = S * normCdf(d1) - K * disc * normCdf(d2);
    const theta = (-(S * pdf * sigma) / (2 * sqrtT) - r * K * disc * normCdf(d2)) / 365;
    return { price, delta: normCdf(d1), gamma, theta, vega };
  }
  const price = K * disc * normCdf(-d2) - S * normCdf(-d1);
  const theta = (-(S * pdf * sigma) / (2 * sqrtT) + r * K * disc * normCdf(-d2)) / 365;
  return { price, delta: normCdf(d1) - 1, gamma, theta, vega };
}

/** Clamp realised vol into a sane band, or fall back when missing. */
export function baseVol(realized: number | null | undefined) {
  if (realized == null || !Number.isFinite(realized) || realized <= 0) return FALLBACK_VOL;
  return Math.min(1.6, Math.max(0.12, realized));
}

/**
 * Indicative implied volatility for a strike: base vol with a put-side skew and a smile.
 * Outside regular hours the surface widens to reflect gap risk at the next open.
 */
export function indicativeIv(base: number, S: number, K: number, offHours = false) {
  const m = Math.log(K / S);
  const iv = base * (1 - 0.45 * m + 1.6 * m * m);
  return Math.min(2.5, Math.max(0.08, iv)) * (offHours ? 1.08 : 1);
}

export function strikeStep(S: number) {
  if (S < 25) return 0.5;
  if (S < 60) return 1;
  if (S < 150) return 2.5;
  if (S < 400) return 5;
  if (S < 1000) return 10;
  return 25;
}

export const roundStrike = (S: number, x: number) => {
  const step = strikeStep(S);
  return Math.round(x / step) * step;
};

export function strikesAround(S: number, count = 15) {
  const step = strikeStep(S);
  const atm = Math.round(S / step) * step;
  const half = Math.floor(count / 2);
  return Array.from({ length: count }, (_, i) => +(atm + (i - half) * step).toFixed(2)).filter((k) => k > 0);
}

/* ------------------------------------------------------------------ expiries */

export type Expiry = {
  id: string;
  label: string;
  short: string;
  date: Date;
  T: number;
  days: number;
  monthly: boolean;
};

/** Offset (minutes) of America/New_York from UTC at `d`. */
function nyOffsetMinutes(d: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return Math.round((asUtc - d.getTime()) / 60000);
}

/** 4pm New York on the given calendar day, as a Date. */
function nyClose(y: number, m: number, day: number) {
  const guess = new Date(Date.UTC(y, m, day, 20, 0));
  return new Date(Date.UTC(y, m, day, 16, 0) - nyOffsetMinutes(guess) * 60000);
}

const isThirdFriday = (d: Date) => d.getUTCDay() === 5 && d.getUTCDate() >= 15 && d.getUTCDate() <= 21;

/** Upcoming Friday expiries: the next six weeklies plus the next two monthlies after them. */
export function upcomingExpiries(now = new Date()): Expiry[] {
  const out: Expiry[] = [];
  const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let weeklies = 0;
  let monthlies = 0;
  for (let i = 0; i < 120 && (weeklies < 6 || monthlies < 2); i++) {
    const d = new Date(cursor.getTime() + i * 86400000);
    if (d.getUTCDay() !== 5) continue;
    const close = nyClose(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const ms = close.getTime() - now.getTime();
    if (ms < 36 * 3600 * 1000) continue; // skip expiries less than a day and a half away
    const monthly = isThirdFriday(d);
    if (weeklies < 6) weeklies++;
    else if (monthly) monthlies++;
    else continue;
    const days = Math.round(ms / 86400000);
    out.push({
      id: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
      short: d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
      date: close,
      T: ms / YEAR_MS,
      days,
      monthly,
    });
  }
  return out;
}

export function expiryForHorizon(days: number, now = new Date()) {
  const list = upcomingExpiries(now);
  return list.find((e) => e.days >= days) ?? list[list.length - 1]!;
}

/* ------------------------------------------------------------------ positions */

export type Leg = {
  kind: OptionType | "stock";
  /** +1 long, -1 short. */
  side: 1 | -1;
  qty: number;
  strike?: number;
  T?: number;
  iv?: number;
  /** Per unit premium (options) or entry price (stock). */
  price: number;
  expiryLabel?: string;
};

export function priceLeg(
  kind: OptionType,
  side: 1 | -1,
  S: number,
  K: number,
  exp: Expiry,
  vol: number,
  qty: number,
  offHours = false,
): Leg {
  const iv = indicativeIv(vol, S, K, offHours);
  return {
    kind,
    side,
    qty,
    strike: K,
    T: exp.T,
    iv,
    price: blackScholes(kind, S, K, exp.T, iv).price,
    expiryLabel: exp.label,
  };
}

/** P&L of the book at expiry for a terminal price. */
export function payoffAt(legs: Leg[], ST: number) {
  let pnl = 0;
  for (const l of legs) {
    if (l.kind === "stock") pnl += l.side * l.qty * (ST - l.price);
    else {
      const intrinsic = l.kind === "call" ? Math.max(ST - l.strike!, 0) : Math.max(l.strike! - ST, 0);
      pnl += l.side * l.qty * (intrinsic - l.price);
    }
  }
  return pnl;
}

/** Mark-to-model P&L if spot moved to S right now, after `daysForward` days pass. */
export function valueAt(legs: Leg[], S: number, daysForward = 0) {
  let pnl = 0;
  for (const l of legs) {
    if (l.kind === "stock") pnl += l.side * l.qty * (S - l.price);
    else {
      const T = Math.max(0, (l.T ?? 0) - daysForward / 365);
      const v = blackScholes(l.kind, S, l.strike!, T, l.iv ?? FALLBACK_VOL).price;
      pnl += l.side * l.qty * (v - l.price);
    }
  }
  return pnl;
}

export function netGreeks(legs: Leg[], S: number) {
  const g = { delta: 0, gamma: 0, theta: 0, vega: 0 };
  for (const l of legs) {
    if (l.kind === "stock") {
      g.delta += l.side * l.qty;
      continue;
    }
    const b = blackScholes(l.kind, S, l.strike!, l.T ?? 0, l.iv ?? FALLBACK_VOL);
    g.delta += l.side * l.qty * b.delta;
    g.gamma += l.side * l.qty * b.gamma;
    g.theta += l.side * l.qty * b.theta;
    g.vega += l.side * l.qty * b.vega;
  }
  return g;
}

/** Net premium: positive = paid (debit), negative = received (credit). Stock legs excluded. */
export const netPremium = (legs: Leg[]) =>
  legs.reduce((a, l) => (l.kind === "stock" ? a : a + l.side * l.qty * l.price), 0);

/**
 * Worst and best outcome at expiry. Uses the far-right slope to detect unbounded gain; a book
 * where every short call is covered can never have unbounded loss.
 */
export function maxLossGain(legs: Leg[], S: number) {
  const strikes = legs.filter((l) => l.strike).map((l) => l.strike!);
  const hi = Math.max(S, ...strikes) * 3;
  const pts = [0, ...strikes, S, hi];
  for (let i = 1; i <= 200; i++) pts.push((hi * i) / 200);
  const vals = pts.map((p) => payoffAt(legs, p));
  const slope = legs.reduce((a, l) => (l.kind === "call" || l.kind === "stock" ? a + l.side * l.qty : a), 0);
  const maxLoss = Math.min(...vals);
  const maxGain = slope > 1e-9 ? Infinity : Math.max(...vals);
  return { maxLoss: Math.min(0, maxLoss), maxGain, unboundedLoss: slope < -1e-9 };
}

/** Breakeven terminal prices (sign changes of the expiry payoff). */
export function breakevens(legs: Leg[], S: number) {
  const hi = S * 2.5;
  const out: number[] = [];
  let prev = payoffAt(legs, 0.01);
  const N = 1000;
  for (let i = 1; i <= N; i++) {
    const x = (hi * i) / N;
    const v = payoffAt(legs, x);
    if ((prev < 0 && v >= 0) || (prev > 0 && v <= 0)) out.push(x);
    prev = v;
  }
  return out;
}

/**
 * Collateral a fully collateralised venue would lock at open: covered calls lock the share, cash-secured puts
 * lock strike × size in cash, long options lock their premium, spreads lock their max loss.
 */
export function collateralFor(legs: Leg[], S: number) {
  const { maxLoss } = maxLossGain(legs, S);
  return Math.abs(maxLoss);
}

/** The most recent Friday 4pm New York before `now`: the start of the current weekly option cycle. */
export function lastFridayClose(now = new Date()) {
  for (let i = 0; i < 9; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - i * 86400000);
    if (d.getUTCDay() !== 5) continue;
    const close = nyClose(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    if (close.getTime() <= now.getTime()) return close;
  }
  return new Date(now.getTime() - 3 * 86400000);
}
