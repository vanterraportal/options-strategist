import { describe, expect, it } from "vitest";
import { buildStrategy } from "../src/strategy.js";
import { parseIntent } from "../src/intent.js";
import { maxLossGain } from "../src/pricing.js";

const now = new Date("2026-09-30T12:00:00Z");
const build = (prompt: string) => buildStrategy(parseIntent(prompt), 180, 0.45, { now });

describe("buildStrategy", () => {
  it.each([
    ["Bullish NVDA into earnings, capped risk", "Bull call spread", 2],
    ["I own 20 AAPL shares and want to protect them", "Collar", 3],
    ["Neutral SPY for two weeks, collect income", "Covered call", 2],
    ["Bearish TSLA, defined risk", "Bear put spread", 2],
    ["Bullish NVDA", "Long call", 1],
    ["Bearish NVDA", "Long put", 1],
    ["Bullish NVDA, collect premium", "Cash-secured put", 1],
    ["Neutral NVDA", "Iron condor", 4],
  ])("%s → %s", (prompt, name, legs) => {
    const s = build(prompt);
    expect(s.name).toBe(name);
    expect(s.legs).toHaveLength(legs);
  });

  it("never builds a book with unbounded loss", () => {
    for (const p of ["Bullish NVDA", "Bearish NVDA", "Neutral NVDA", "Neutral NVDA income", "hedge my NVDA"]) {
      expect(maxLossGain(build(p).legs, 180).unboundedLoss).toBe(false);
    }
  });

  it("widens the surface off hours", () => {
    const on = build("Bullish NVDA").legs[0]!.price;
    const off = buildStrategy(parseIntent("Bullish NVDA"), 180, 0.45, { now, offHours: true }).legs[0]!.price;
    expect(off).toBeGreaterThan(on);
  });
});
