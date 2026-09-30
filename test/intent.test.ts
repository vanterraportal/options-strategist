import { describe, expect, it } from "vitest";
import { parseIntent } from "../src/intent.js";

type Expect = Partial<{
  ticker: string | null;
  view: string;
  capped: boolean;
  earnings: boolean;
  income: boolean;
  hedge: boolean;
  horizonDays: number;
  qty: number;
}>;

const CASES: Array<[string, Expect]> = [
  [
    "Bullish NVDA into earnings, capped risk",
    { ticker: "NVDA", view: "bullish", capped: true, earnings: true, horizonDays: 35 },
  ],
  [
    "I own 20 AAPL shares and want to protect them this month",
    { ticker: "AAPL", hedge: true, qty: 20, horizonDays: 30 },
  ],
  ["Neutral SPY for two weeks, collect income", { ticker: "SPY", view: "neutral", income: true, horizonDays: 14 }],
  ["Bearish TSLA, defined risk", { ticker: "TSLA", view: "bearish", capped: true }],
  ["I think nvidia will rally", { ticker: "NVDA", view: "bullish" }],
  ["the market will crash this week", { ticker: "SPY", view: "bearish", horizonDays: 7 }],
  ["sideways on the nasdaq for a quarter", { ticker: "QQQ", view: "neutral", horizonDays: 60 }],
  ["$PLTR moon", { ticker: "PLTR", view: "bullish" }],
  ["Long MSFT, sell covered calls for yield", { ticker: "MSFT", view: "bullish", income: true }],
  ["hedge my 100 shares of google", { ticker: "GOOGL", hedge: true, qty: 100 }],
  ["up or down, no idea", { ticker: null, view: "neutral" }],
  ["cheap upside on AMZN", { ticker: "AMZN", view: "bullish", capped: true }],
  ["ETF talk: IV is high on COIN", { ticker: "COIN", view: "neutral" }],
  ["gold looks calm", { ticker: "GLD", view: "neutral" }],
  ["short facebook after the report", { ticker: "META", view: "bearish", earnings: true }],
];

describe("parseIntent (rules)", () => {
  it.each(CASES)("%s", (prompt, expected) => {
    expect(parseIntent(prompt)).toMatchObject(expected);
  });

  it("restricts tickers to an allow-list", () => {
    expect(parseIntent("Bullish XYZ", { tickers: ["NVDA"] }).ticker).toBeNull();
    expect(parseIntent("Bullish XYZ").ticker).toBe("XYZ");
    expect(parseIntent("bullish nvidia", { tickers: ["AAPL"] }).ticker).toBeNull();
  });

  it("accepts custom aliases", () => {
    expect(parseIntent("bearish on the vanterra index", { aliases: { vanterra: "VNT" } }).ticker).toBe("VNT");
  });

  it("records auditable signals", () => {
    expect(parseIntent("Bullish NVDA into earnings, capped risk").signals).toEqual([
      "NVDA",
      "bullish",
      "capped risk",
      "earnings",
      "~1 month",
    ]);
  });
});
