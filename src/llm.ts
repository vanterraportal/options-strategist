import { parseIntent, type Intent, type ParseOptions } from "./intent.js";

/**
 * Reads a plain-English view into an Intent. With an Anthropic API key, Claude does the reading
 * through a tool call; without one (or on any failure) the deterministic rules engine does.
 * Either way the strategy legs are priced by `buildStrategy`, never by the model.
 */

export const DEFAULT_MODEL = "claude-sonnet-5-5";

export const DEFAULT_SYSTEM =
  "You read an options trader's view. Call the set_intent tool exactly once to record it as structured fields. " +
  "Only extract the view. Never recommend trades or predict prices.";

export type ReadIntentOptions = ParseOptions & {
  /** Anthropic API key. Without it the rules engine answers and no request is made. */
  apiKey?: string;
  /** Claude model id. Defaults to `DEFAULT_MODEL`. */
  model?: string;
  /** System prompt. Defaults to `DEFAULT_SYSTEM`. */
  system?: string;
  /** API base URL, e.g. a proxy or AI gateway. Defaults to `https://api.anthropic.com`. */
  baseUrl?: string;
  /** Request timeout in milliseconds. Defaults to 15000. */
  timeoutMs?: number;
  /** Custom fetch, for tests or runtimes without a global one. */
  fetch?: typeof fetch;
};

export type ReadIntentResult = {
  mode: "ai" | "rules";
  intent: Intent;
  rationale: string | null;
  model?: string;
};

function intentTool(tickers: string[] | undefined) {
  const ticker = tickers
    ? { type: ["string", "null"], enum: [...tickers.map((s) => s.toUpperCase()), null] }
    : { type: ["string", "null"], description: "Uppercase ticker symbol, or null if none is named." };
  return {
    name: "set_intent",
    description: "Record the trader's view as structured fields.",
    input_schema: {
      type: "object",
      properties: {
        ticker,
        view: { type: "string", enum: ["bullish", "bearish", "neutral"] },
        capped: { type: "boolean", description: "User wants defined or capped risk." },
        earnings: { type: "boolean", description: "View is about an earnings report." },
        income: { type: "boolean", description: "User wants to collect premium or income." },
        hedge: { type: "boolean", description: "User owns shares and wants protection." },
        horizonDays: { type: "integer", description: "Holding horizon in days, 3 to 90." },
        qty: { type: "integer", description: "Shares, 1 to 10000. Default 10." },
        rationale: {
          type: "string",
          description: "One or two plain sentences on how you read the view. No advice, no promises.",
        },
      },
      required: ["ticker", "view", "capped", "earnings", "income", "hedge", "horizonDays", "qty", "rationale"],
    },
  };
}

type MessagesResponse = {
  stop_reason?: string;
  content?: Array<{ type: string; name?: string; input?: Record<string, unknown> }>;
};

export async function readIntent(text: string, options: ReadIntentOptions = {}): Promise<ReadIntentResult> {
  const rules = parseIntent(text, options);
  const fallback: ReadIntentResult = { mode: "rules", intent: rules, rationale: null };
  if (!options.apiKey) return fallback;
  const model = options.model ?? DEFAULT_MODEL;
  const doFetch = options.fetch ?? fetch;
  const allowed = options.tickers ? new Set(options.tickers.map((s) => s.toUpperCase())) : null;
  try {
    const res = await doFetch(`${options.baseUrl ?? "https://api.anthropic.com"}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": options.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        output_config: { effort: "low" },
        system: options.system ?? DEFAULT_SYSTEM,
        tools: [intentTool(options.tickers)],
        // Forced tool_choice is rejected by newer models, so steer with the prompt instead.
        tool_choice: { type: "auto" },
        messages: [{ role: "user", content: text.slice(0, 600) }],
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 15000),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}`);
    const body = (await res.json()) as MessagesResponse;
    if (body.stop_reason === "refusal") throw new Error("refused");
    const input = body.content?.find((c) => c.type === "tool_use" && c.name === "set_intent")?.input;
    if (!input) throw new Error("no tool call");
    const raw = typeof input.ticker === "string" ? input.ticker.toUpperCase().replace("$", "") : null;
    const ticker = raw && (allowed ? allowed.has(raw) : /^[A-Z]{1,5}$/.test(raw)) ? raw : rules.ticker;
    const view =
      input.view === "bullish" || input.view === "bearish" || input.view === "neutral" ? input.view : rules.view;
    const intent: Intent = {
      ticker,
      view,
      capped: Boolean(input.capped),
      earnings: Boolean(input.earnings),
      income: Boolean(input.income),
      hedge: Boolean(input.hedge),
      horizonDays: Math.min(90, Math.max(3, Number(input.horizonDays) || rules.horizonDays)),
      qty: Math.min(10000, Math.max(1, Number(input.qty) || rules.qty)),
      signals: [],
    };
    intent.signals = [
      ticker ?? "",
      view,
      intent.capped ? "capped risk" : "",
      intent.earnings ? "earnings" : "",
      intent.income ? "income" : "",
      intent.hedge ? "hedge" : "",
      `~${intent.horizonDays} days`,
    ].filter(Boolean);
    return { mode: "ai", intent, rationale: typeof input.rationale === "string" ? input.rationale : null, model };
  } catch {
    return fallback;
  }
}
