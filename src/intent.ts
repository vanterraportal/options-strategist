/**
 * Rules engine. A deterministic, rules-based reading of a plain-English view. It extracts the
 * ticker, direction, risk appetite and event. The optional Claude path (`readIntent`) only
 * replaces this *reading*; pricing and legs always come from `buildStrategy`.
 */

export type View = "bullish" | "bearish" | "neutral";

export type Intent = {
  ticker: string | null;
  view: View;
  capped: boolean;
  earnings: boolean;
  income: boolean;
  hedge: boolean;
  horizonDays: number;
  qty: number;
  /** What the parser picked up, shown as chips so the reading is auditable. */
  signals: string[];
};

export type ParseOptions = {
  /**
   * Allowed symbols. When set, only these are recognised. When omitted, any uppercase
   * 2-5 letter word (or `$TICKER`) that is not a common trading acronym counts as a ticker.
   */
  tickers?: string[];
  /** Company or index names mapped to a symbol, e.g. `{ nvidia: "NVDA" }`. Defaults to `DEFAULT_ALIASES`. */
  aliases?: Record<string, string>;
};

/** Common names for widely traded US stocks and ETFs. Matched case-insensitively as whole words. */
export const DEFAULT_ALIASES: Record<string, string> = {
  nvidia: "NVDA",
  apple: "AAPL",
  tesla: "TSLA",
  microsoft: "MSFT",
  amazon: "AMZN",
  meta: "META",
  facebook: "META",
  alphabet: "GOOGL",
  google: "GOOGL",
  netflix: "NFLX",
  palantir: "PLTR",
  coinbase: "COIN",
  robinhood: "HOOD",
  gamestop: "GME",
  "s&p": "SPY",
  "s and p": "SPY",
  "the market": "SPY",
  nasdaq: "QQQ",
  gold: "GLD",
};

/** Uppercase words that show up in trading talk but are not tickers. */
const NOT_TICKERS = new Set([
  "AI", "ATM", "CEO", "CFO", "DTE", "EOD", "EPS", "ER", "ETF", "EU", "FOMC", "GDP", "IPO", "ITM", "IV", "OK",
  "OTM", "PM", "AM", "UK", "US", "USA", "USD", "USDC", "USDG", "YOLO", "CPI", "FED",
]); // prettier-ignore

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function aliasPatterns(aliases: Record<string, string>, allowed: Set<string> | null): Array<[RegExp, string]> {
  return Object.entries(aliases)
    .filter(([, sym]) => !allowed || allowed.has(sym))
    .map(([name, sym]) => [new RegExp(`(^|[^a-z0-9])${escape(name.toLowerCase())}(?![a-z0-9])`, "i"), sym]);
}

const has = (t: string, re: RegExp) => re.test(t);

export function parseIntent(input: string, options: ParseOptions = {}): Intent {
  const allowed = options.tickers ? new Set(options.tickers.map((s) => s.toUpperCase())) : null;
  const t = ` ${input.toLowerCase()} `;
  const signals: string[] = [];
  let ticker: string | null = null;
  // Prefer an explicit ticker over a company-name match.
  const upper = input.match(/\$?\b[A-Z]{2,5}\b/g) ?? [];
  for (const u of upper) {
    const sym = u.replace("$", "");
    const ok = allowed ? allowed.has(sym) : u.startsWith("$") || !NOT_TICKERS.has(sym);
    if (ok) {
      ticker = sym;
      break;
    }
  }
  if (!ticker)
    for (const [re, sym] of aliasPatterns(options.aliases ?? DEFAULT_ALIASES, allowed))
      if (re.test(input)) {
        ticker = sym;
        break;
      }
  if (ticker) signals.push(ticker);

  const bull = has(t, /\b(bull|bullish|long|up|upside|rally|rip|moon|higher|rise|breakout|call)\b/);
  const bear = has(t, /\b(bear|bearish|short|down|downside|drop|fall|crash|lower|sell ?off|dump|put)\b/);
  const flat = has(t, /\b(neutral|flat|sideways|range|rangebound|range-bound|chop|stable|calm|pin)\b/);
  let view: View = "neutral";
  if (bull && !bear) view = "bullish";
  else if (bear && !bull) view = "bearish";
  else if (flat) view = "neutral";
  else if (bull && bear) view = "neutral";
  signals.push(view);

  const capped = has(
    t,
    /\b(cap|capped|defined|limited|small|safe|protect(ed)?|max loss|risk[- ]?(managed|controlled)|cheap)\b/,
  );
  if (capped) signals.push("capped risk");
  const earnings = has(t, /\b(earnings|report|er|quarter|results|guidance)\b/);
  if (earnings) signals.push("earnings");
  const income = has(t, /\b(income|yield|premium|collect|rent|cash ?flow|dividend|covered|wheel)\b/);
  if (income) signals.push("income");
  const hedge = has(t, /\b(hedge|protect|insure|insurance|downside protection|collar|own|holding|my shares)\b/);
  if (hedge) signals.push("hedge");

  let horizonDays = earnings ? 35 : 30;
  if (has(t, /\b(today|tomorrow|this week|week|weekly|days?)\b/)) horizonDays = 7;
  if (has(t, /\b(two weeks|2 weeks|fortnight)\b/)) horizonDays = 14;
  if (has(t, /\b(month|monthly|30 days)\b/)) horizonDays = 30;
  if (has(t, /\b(quarter|3 months|two months|2 months|60 days)\b/)) horizonDays = 60;
  signals.push(
    horizonDays <= 7 ? "~1 week" : horizonDays <= 14 ? "~2 weeks" : horizonDays <= 35 ? "~1 month" : "~2 months",
  );

  const q = input.match(/(\d{1,5})\s*(shares|share|contracts|contract|x)\b/i);
  const qty = q ? Math.min(10000, Math.max(1, Number(q[1]))) : 10;
  if (q) signals.push(`${qty} shares`);

  return { ticker, view, capped, earnings, income, hedge, horizonDays, qty, signals };
}

export const EXAMPLE_PROMPTS = [
  "Bullish NVDA into earnings, capped risk",
  "I own 20 AAPL shares and want to protect them this month",
  "Neutral SPY for two weeks, collect income",
  "Bearish TSLA, defined risk",
];
