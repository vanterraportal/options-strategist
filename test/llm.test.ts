import { describe, expect, it, vi } from "vitest";
import { DEFAULT_MODEL, readIntent } from "../src/llm.js";

const toolResponse = (input: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({ stop_reason: "tool_use", content: [{ type: "tool_use", name: "set_intent", input }], ...extra }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );

const aiInput = {
  ticker: "TSLA",
  view: "bearish",
  capped: true,
  earnings: false,
  income: false,
  hedge: false,
  horizonDays: 21,
  qty: 5,
  rationale: "Bearish on Tesla with defined risk.",
};

describe("readIntent", () => {
  it("uses the rules engine without a key and makes no request", async () => {
    const f = vi.fn();
    const r = await readIntent("Bullish NVDA", { fetch: f });
    expect(r.mode).toBe("rules");
    expect(r.intent.ticker).toBe("NVDA");
    expect(f).not.toHaveBeenCalled();
  });

  it("uses the tool result from Claude", async () => {
    const f = vi.fn(async () => toolResponse(aiInput));
    const r = await readIntent("tesla looks heavy", { apiKey: "k", fetch: f as unknown as typeof fetch });
    expect(r.mode).toBe("ai");
    expect(r.model).toBe(DEFAULT_MODEL);
    expect(r.intent).toMatchObject({ ticker: "TSLA", view: "bearish", capped: true, horizonDays: 21, qty: 5 });
    expect(r.rationale).toBe(aiInput.rationale);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe(DEFAULT_MODEL);
    expect(body.tool_choice).toEqual({ type: "auto" });
  });

  it("passes model, base URL and the ticker allow-list", async () => {
    const f = vi.fn(async () => toolResponse({ ...aiInput, ticker: "ZZZ" }));
    const r = await readIntent("bearish NVDA", {
      apiKey: "k",
      model: "claude-opus-5-5",
      baseUrl: "https://gw.example",
      tickers: ["NVDA", "TSLA"],
      fetch: f as unknown as typeof fetch,
    });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://gw.example/v1/messages");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.tools[0].input_schema.properties.ticker.enum).toEqual(["NVDA", "TSLA", null]);
    // ZZZ is not allowed, so the rules reading wins.
    expect(r.intent.ticker).toBe("NVDA");
  });

  it("clamps out-of-range numbers", async () => {
    const f = vi.fn(async () => toolResponse({ ...aiInput, horizonDays: 900, qty: -4 }));
    const r = await readIntent("x", { apiKey: "k", fetch: f as unknown as typeof fetch });
    expect(r.intent.horizonDays).toBe(90);
    expect(r.intent.qty).toBe(1);
  });

  it.each([
    ["network error", async () => Promise.reject(new Error("offline"))],
    ["HTTP 400", async () => new Response("bad", { status: 400 })],
    ["garbage JSON", async () => new Response("not json", { status: 200 })],
    ["no tool call", async () => new Response(JSON.stringify({ content: [{ type: "text", text: "hi" }] }))],
    ["refusal", async () => toolResponse(aiInput, { stop_reason: "refusal" })],
  ])("falls back to rules on %s", async (_, impl) => {
    const r = await readIntent("Bullish NVDA into earnings", {
      apiKey: "k",
      fetch: vi.fn(impl) as unknown as typeof fetch,
    });
    expect(r.mode).toBe("rules");
    expect(r.intent).toMatchObject({ ticker: "NVDA", view: "bullish", earnings: true });
    expect(r.rationale).toBeNull();
  });
});
