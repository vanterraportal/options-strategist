# @vanterra/options-strategist

Turn a plain-English view into a priced, fully collateralised multi-leg options strategy.

```
"Bullish NVDA into earnings, capped risk"
  → { ticker: "NVDA", view: "bullish", capped: true, earnings: true, horizonDays: 35, ... }
  → Bull call spread: long 180 call, short 215 call, net debit, max loss/gain, breakevens
```

- **Rules engine by default.** `parseIntent` is deterministic, has no network calls and shows what it picked up as `signals`, so every reading is auditable.
- **Claude when you want it.** With an Anthropic API key, `readIntent` lets Claude read the view through a tool call. On any failure (no key, HTTP error, refusal, malformed output) it falls back to the rules engine.
- **The model never prices anything.** Legs, strikes and premiums always come from `buildStrategy` and Black-Scholes in this package.
- **No runtime dependencies.** Plain `fetch`, so it runs in Node 20+, Cloudflare Workers, Deno, Bun and browsers (put the API key behind your own proxy in a browser).

## Install

```sh
pnpm add @vanterra/options-strategist
```

## Example

```ts
import { buildStrategy, readIntent } from "@vanterra/options-strategist";
import { maxLossGain, breakevens, netPremium, netGreeks } from "@vanterra/options-strategist/pricing";

const { mode, intent, rationale } = await readIntent("Bullish NVDA into earnings, capped risk", {
  apiKey: process.env.ANTHROPIC_API_KEY, // optional: omit to use the rules engine only
  tickers: ["NVDA", "AAPL", "TSLA", "SPY"], // optional allow-list
});

const spot = 181.2; // your live price
const vol = 0.42; // e.g. 30-day realised volatility
const strategy = buildStrategy(intent, spot, vol);

console.log(mode, strategy.name, strategy.expiry.label);
for (const leg of strategy.legs) console.log(leg.side > 0 ? "buy" : "sell", leg.qty, leg.kind, leg.strike, leg.price);
console.log({
  netPremium: netPremium(strategy.legs), // + debit, − credit
  ...maxLossGain(strategy.legs, spot),
  breakevens: breakevens(strategy.legs, spot),
  greeks: netGreeks(strategy.legs, spot),
  rationale,
});
```

## API

### `parseIntent(text, { tickers?, aliases? }): Intent`

Rules-based reading. `tickers` restricts recognised symbols; without it any uppercase 2–5 letter word (or `$TICKER`) that is not a common trading acronym counts. `aliases` maps names to symbols (defaults to `DEFAULT_ALIASES`, e.g. `nvidia → NVDA`, `the market → SPY`).

```ts
type Intent = {
  ticker: string | null;
  view: "bullish" | "bearish" | "neutral";
  capped: boolean; // wants defined risk
  earnings: boolean; // view is about a report
  income: boolean; // wants premium
  hedge: boolean; // owns shares, wants protection
  horizonDays: number;
  qty: number; // shares, default 10
  signals: string[]; // what the parser picked up
};
```

### `readIntent(text, options): Promise<{ mode: "ai" | "rules"; intent; rationale; model? }>`

Options: everything `parseIntent` takes, plus `apiKey`, `model` (default `DEFAULT_MODEL`, `claude-sonnet-5-5`), `system`, `baseUrl` (for a proxy or AI gateway), `timeoutMs` (default 15000) and `fetch`. Numbers from the model are clamped (horizon 3–90 days, qty 1–10000) and a ticker outside the allow-list is ignored in favour of the rules reading.

### `buildStrategy(intent, spot, vol, { offHours?, now? }): Strategy`

| View            | Extra              | Strategy         |
| --------------- | ------------------ | ---------------- |
| any but bullish | hedge              | Collar           |
| bullish         | income, not capped | Cash-secured put |
| bullish         | capped or earnings | Bull call spread |
| bullish         | –                  | Long call        |
| bearish         | capped or earnings | Bear put spread  |
| bearish         | –                  | Long put         |
| neutral         | income             | Covered call     |
| neutral         | –                  | Iron condor      |

Every strategy is fully collateralised: no uncovered short call, so loss is always bounded. Earnings views price the legs with a 20% event premium on vol. `offHours` widens the surface for gap risk at the next open.

### `@vanterra/options-strategist/pricing`

`blackScholes`, `indicativeIv`, `baseVol`, `upcomingExpiries`, `expiryForHorizon`, `strikeStep`, `roundStrike`, `strikesAround`, `priceLeg`, `payoffAt`, `valueAt`, `netGreeks`, `netPremium`, `maxLossGain`, `breakevens`, `collateralFor`, `lastFridayClose`.

## Limits

- **Indicative, not a quote.** Prices are Black-Scholes on the spot and volatility you pass in, with a simple skew and smile. Label them as indicative wherever you show them.
- **Not advice.** The strategist maps a stated view to a textbook structure. It does not judge whether the view is right.
- **Expiries are US-style weekly Fridays** at 4pm New York, plus the next two monthlies. Holidays are not accounted for.
- **Earnings dates are not sourced.** An earnings view picks an expiry about five weeks out; check the real date.
- The rules engine is English-only and keyword-based. Use `readIntent` with a key for looser phrasing.

## License

MIT © 2026 Vanterra
