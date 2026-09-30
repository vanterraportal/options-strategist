import type { Intent } from "./intent.js";
import { expiryForHorizon, priceLeg, roundStrike, strikeStep, type Expiry, type Leg } from "./pricing.js";

export type Strategy = {
  name: string;
  thesis: string;
  hedge: string;
  legs: Leg[];
  expiry: Expiry;
  notes: string[];
};

export type BuildOptions = {
  /** Widen the vol surface for gap risk outside regular hours. */
  offHours?: boolean;
  /** Clock used to pick the expiry. Defaults to now. */
  now?: Date;
};

/** Build a fully collateralised strategy for an intent at spot `S` with base vol `vol`. */
export function buildStrategy(intent: Intent, S: number, vol: number, options: BuildOptions = {}): Strategy {
  const { offHours = false, now } = options;
  const exp = expiryForHorizon(intent.horizonDays, now);
  // Event premium: implied vol tends to run above realised into a report.
  const v = intent.earnings ? vol * 1.2 : vol;
  const q = intent.qty;
  const move = Math.max(strikeStep(S) / S, v * Math.sqrt(exp.T));
  const K = (mult: number) => roundStrike(S, S * mult);
  const atm = K(1);
  const notes: string[] = [];
  if (intent.earnings)
    notes.push(
      "Earnings date is not sourced here. The expiry is picked about five weeks out so it spans a typical quarterly report. Check the date before you sign.",
    );
  const L = (kind: "call" | "put", side: 1 | -1, strike: number) =>
    priceLeg(kind, side, S, strike, exp, v, q, offHours);

  if (intent.hedge && intent.view !== "bullish") {
    const put = K(1 - move * 0.8);
    const call = K(1 + move * 0.9);
    return {
      name: "Collar",
      thesis: `You keep ${q} shares, give up gains above ${fmt(call)} and lock a floor at ${fmt(put)}.`,
      hedge: "The short call pays for most of the protective put, so the floor costs little or nothing.",
      legs: [{ kind: "stock", side: 1, qty: q, price: S }, L("put", 1, put), L("call", -1, call)],
      expiry: exp,
      notes,
    };
  }

  if (intent.view === "bullish") {
    if (intent.income && !intent.capped) {
      const put = K(1 - move * 0.6);
      return {
        name: "Cash-secured put",
        thesis: `Collect premium now and agree to buy ${q} shares at ${fmt(put)} if the price dips there.`,
        hedge: "The strike times size is locked as cash collateral, so assignment is always funded.",
        legs: [L("put", -1, put)],
        expiry: exp,
        notes,
      };
    }
    if (intent.capped || intent.earnings) {
      const k2 = K(1 + move * 1.1);
      return {
        name: "Bull call spread",
        thesis: `Gains if the price rises toward ${fmt(k2)} by ${exp.label}. The most you can lose is the net debit.`,
        hedge: `The short ${fmt(k2)} call finances part of the long call and caps the cost if volatility collapses after the event.`,
        legs: [L("call", 1, atm), L("call", -1, k2 > atm ? k2 : atm + strikeStep(S))],
        expiry: exp,
        notes,
      };
    }
    return {
      name: "Long call",
      thesis: `Full upside above ${fmt(atm)} until ${exp.label}. The premium is the whole risk.`,
      hedge: "No hedge leg: risk is already capped at the premium paid up front.",
      legs: [L("call", 1, atm)],
      expiry: exp,
      notes,
    };
  }

  if (intent.view === "bearish") {
    if (intent.capped || intent.earnings) {
      const k2 = K(1 - move * 1.1);
      return {
        name: "Bear put spread",
        thesis: `Gains if the price falls toward ${fmt(k2)} by ${exp.label}. The most you can lose is the net debit.`,
        hedge: `The short ${fmt(k2)} put lowers the cost and defines the maximum gain.`,
        legs: [L("put", 1, atm), L("put", -1, k2 < atm ? k2 : atm - strikeStep(S))],
        expiry: exp,
        notes,
      };
    }
    return {
      name: "Long put",
      thesis: `Profits below ${fmt(atm)} until ${exp.label}. The premium is the whole risk.`,
      hedge: "No hedge leg: risk is capped at the premium paid up front.",
      legs: [L("put", 1, atm)],
      expiry: exp,
      notes,
    };
  }

  // Neutral
  if (intent.income) {
    const call = K(1 + move * 0.8);
    return {
      name: "Covered call",
      thesis: `Hold ${q} shares and sell the ${fmt(call)} call. Premium is yours; upside above the strike is given up.`,
      hedge: "The shares themselves cover the call, so there is nothing to liquidate.",
      legs: [{ kind: "stock", side: 1, qty: q, price: S }, L("call", -1, call)],
      expiry: exp,
      notes,
    };
  }
  const w = intent.earnings ? 1.0 : 0.8;
  const pS = K(1 - move * w);
  const cS = K(1 + move * w);
  const wing = Math.max(strikeStep(S), roundStrike(S, S * move * 0.6));
  return {
    name: "Iron condor",
    thesis: `Earns the credit if ${exp.label} settles between ${fmt(pS)} and ${fmt(cS)}.${intent.earnings ? " Built to collect the volatility crush after the report." : ""}`,
    hedge: "Long wings on both sides define the maximum loss, which is locked as collateral at open.",
    legs: [L("put", 1, pS - wing), L("put", -1, pS), L("call", -1, cS), L("call", 1, cS + wing)],
    expiry: exp,
    notes,
  };
}

const fmt = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
