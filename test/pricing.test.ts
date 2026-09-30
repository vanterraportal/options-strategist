import { describe, expect, it } from "vitest";
import {
  blackScholes,
  breakevens,
  maxLossGain,
  netPremium,
  payoffAt,
  upcomingExpiries,
  type Leg,
} from "../src/pricing.js";

describe("blackScholes", () => {
  it("satisfies put-call parity", () => {
    const S = 100, K = 105, T = 0.25, sigma = 0.3, r = 0.04; // prettier-ignore
    const c = blackScholes("call", S, K, T, sigma, r).price;
    const p = blackScholes("put", S, K, T, sigma, r).price;
    expect(c - p).toBeCloseTo(S - K * Math.exp(-r * T), 5);
  });

  it("matches a reference value", () => {
    // S=100 K=100 T=1 sigma=0.2 r=0.05 → 10.4506 (Hull)
    expect(blackScholes("call", 100, 100, 1, 0.2, 0.05).price).toBeCloseTo(10.4506, 3);
  });

  it("returns intrinsic at expiry", () => {
    expect(blackScholes("put", 90, 100, 0, 0.3).price).toBe(10);
  });
});

describe("payoff helpers", () => {
  // Long 100 call @ 5, short 110 call @ 2, 1 unit: debit 3, max gain 7.
  const spread: Leg[] = [
    { kind: "call", side: 1, qty: 1, strike: 100, price: 5 },
    { kind: "call", side: -1, qty: 1, strike: 110, price: 2 },
  ];

  it("gives max loss and gain of a bull call spread", () => {
    const { maxLoss, maxGain, unboundedLoss } = maxLossGain(spread, 100);
    expect(maxLoss).toBeCloseTo(-3, 9);
    expect(maxGain).toBeCloseTo(7, 9);
    expect(unboundedLoss).toBe(false);
  });

  it("finds the breakeven and net premium", () => {
    expect(netPremium(spread)).toBe(3);
    expect(payoffAt(spread, 103)).toBeCloseTo(0, 9);
    const [be] = breakevens(spread, 100);
    expect(be).toBeCloseTo(103, 0);
  });

  it("flags unbounded gain on a long call", () => {
    expect(maxLossGain([{ kind: "call", side: 1, qty: 1, strike: 100, price: 4 }], 100).maxGain).toBe(Infinity);
  });
});

describe("upcomingExpiries", () => {
  it("lists Friday expiries in order", () => {
    const list = upcomingExpiries(new Date("2026-09-30T12:00:00Z"));
    expect(list.length).toBeGreaterThanOrEqual(6);
    expect(list[0]!.id).toBe("2026-10-02");
    for (const e of list) expect(new Date(e.id).getUTCDay()).toBe(5);
  });
});
