import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";

vi.mock("../trigger/tools/registry.js", () => {
  const tool = {
    id: "echo_tool",
    name: "echo_tool",
    description: "Echoes the input",
    schema: z.object({ message: z.string() }),
    parameters: { type: "object", properties: { message: { type: "string" } }, required: ["message"] },
    handler: vi.fn(async (params: { message: string }) => ({ ok: true, echoed: params.message })),
  };
  return {
    listTools: vi.fn(() => [tool]),
    getTool: vi.fn((name: string) => (name === "echo_tool" ? tool : undefined)),
  };
});

import { runLlmAgent, parseWayfareAnswer, WayfareAnswerSchema } from "./client.js";
import * as registry from "../trigger/tools/registry.js";

type EchoTool = {
  id: string;
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  parameters: Record<string, unknown>;
  handler: ReturnType<typeof vi.fn>;
};

function getEchoTool(): EchoTool {
  const tools = (registry.listTools as unknown as () => EchoTool[])();
  return tools[0]!;
}

type SinkEvent = { type: string; [k: string]: unknown };

function makeAssistant(content: string | null, toolCalls?: Array<{ id: string; name: string; arguments: string }>) {
  const message: Record<string, unknown> = { role: "assistant", content };
  if (toolCalls && toolCalls.length > 0) message.tool_calls = toolCalls;
  return JSON.stringify({ choices: [{ message }] });
}

function okResponse(content: string | null, toolCalls?: Array<{ id: string; name: string; arguments: string }>) {
  return new Response(makeAssistant(content, toolCalls), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function toolCallResponse(id: string, name: string, args: unknown) {
  return okResponse("", [{ id, name, arguments: typeof args === "string" ? args : JSON.stringify(args) }]);
}

const VALID_SUMMARY_ANSWER = { kind: "summary", text: "Here are your results." };
const VALID_QUESTION_ANSWER = { kind: "question", text: "Which month do you want to travel?", suggestions: ["June", "July"] };

describe("runLlmAgent: credentials", () => {
  it("returns ok:false, source:none, error when apiKey missing and emits error event", async () => {
    const events: SinkEvent[] = [];
    const res = await runLlmAgent(
      { messages: [{ role: "user", content: "hi" }] },
      { provider: "openai", apiKey: "" },
      (e) => events.push(e as SinkEvent),
    );
    expect(res.ok).toBe(false);
    expect(res.source).toBe("none");
    expect(res.error).toMatch(/No LLM credentials/i);
    expect(res.iterations).toBe(0);
    expect(events.some((e) => e.type === "error" && e.error === "no_credentials")).toBe(true);
    expect(events.some((e) => e.type === "status")).toBe(false);
  });

  it("emits status(thinking) on the happy path", async () => {
    const fetchMock = vi.fn(async () => okResponse(JSON.stringify(VALID_SUMMARY_ANSWER)));
    vi.stubGlobal("fetch", fetchMock);
    const events: SinkEvent[] = [];
    const res = await runLlmAgent(
      { messages: [{ role: "user", content: "hi" }] },
      { provider: "openai", apiKey: "sk-test" },
      (e) => events.push(e as SinkEvent),
    );
    expect(res.ok).toBe(true);
    expect(events[0]).toMatchObject({ type: "status", status: "thinking", provider: "openai" });
    vi.unstubAllGlobals();
  });
});

describe("runLlmAgent: maxIterations clamp", () => {
  it("clamps maxIterations to [1,20]", async () => {
    const fetchMock = vi.fn(async () => okResponse(JSON.stringify(VALID_SUMMARY_ANSWER)));
    vi.stubGlobal("fetch", fetchMock);
    for (const v of [0, -5, 100, 999]) {
      const res = await runLlmAgent(
        { messages: [{ role: "user", content: "x" }], maxIterations: v },
        { provider: "openai", apiKey: "sk-test" },
      );
      expect(res.iterations).toBeLessThanOrEqual(20);
      expect(res.iterations).toBeGreaterThanOrEqual(1);
    }
    vi.unstubAllGlobals();
  });
});

describe("runLlmAgent: structured answer flow", () => {
  it("parses a valid WayfareAnswer JSON on the final iteration and emits an answer event", async () => {
    const fetchMock = vi.fn(async () => okResponse(JSON.stringify(VALID_SUMMARY_ANSWER)));
    vi.stubGlobal("fetch", fetchMock);
    const events: SinkEvent[] = [];
    const res = await runLlmAgent(
      { messages: [{ role: "user", content: "go" }] },
      { provider: "openai", apiKey: "sk-test" },
      (e) => events.push(e as SinkEvent),
    );
    expect(res.ok).toBe(true);
    expect(res.answer).toEqual(VALID_SUMMARY_ANSWER);
    const answerEv = events.find((e) => e.type === "answer");
    expect(answerEv).toBeTruthy();
    expect(answerEv?.answer).toEqual(VALID_SUMMARY_ANSWER);
    expect(events.find((e) => e.type === "done")).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it("retries once with a correction nudge when final JSON is invalid, then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse("not json at all"))
      .mockResolvedValueOnce(okResponse(JSON.stringify(VALID_QUESTION_ANSWER)));
    vi.stubGlobal("fetch", fetchMock);
    const res = await runLlmAgent(
      { messages: [{ role: "user", content: "go" }] },
      { provider: "openai", apiKey: "sk-test" },
    );
    expect(res.ok).toBe(true);
    expect(res.answer).toEqual(VALID_QUESTION_ANSWER);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it("falls back to a structured error answer when JSON parsing fails persistently", async () => {
    const fetchMock = vi.fn(async () => okResponse("not json"));
    vi.stubGlobal("fetch", fetchMock);
    const events: SinkEvent[] = [];
    const res = await runLlmAgent(
      { messages: [{ role: "user", content: "go" }], maxIterations: 2 },
      { provider: "openai", apiKey: "sk-test" },
      (e) => events.push(e as SinkEvent),
    );
    expect(res.ok).toBe(true);
    expect(res.answer).toMatchObject({ kind: "error" });
    expect(events.some((e) => e.type === "error" && String(e.error).startsWith("invalid_answer"))).toBe(true);
    vi.unstubAllGlobals();
  });

  it("falls back to error answer when JSON parses but doesn't match schema", async () => {
    const fetchMock = vi.fn(async () => okResponse(JSON.stringify({ kind: "weird_kind", data: 1 })));
    vi.stubGlobal("fetch", fetchMock);
    const res = await runLlmAgent(
      { messages: [{ role: "user", content: "go" }], maxIterations: 2 },
      { provider: "openai", apiKey: "sk-test" },
    );
    expect(res.answer).toMatchObject({ kind: "error" });
    vi.unstubAllGlobals();
  });

  it("sends response_format: json_object on the final answer call", async () => {
    const fetchMock = vi.fn(async (_url?: string, _init?: RequestInit) => okResponse(JSON.stringify(VALID_SUMMARY_ANSWER)));
    vi.stubGlobal("fetch", fetchMock);
    await runLlmAgent(
      { messages: [{ role: "user", content: "go" }] },
      { provider: "openai", apiKey: "sk-test" },
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(call[1].body as string);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.stream).toBe(false);
    expect(body.tool_choice).toBe("auto");
    expect(Array.isArray(body.tools)).toBe(true);
    vi.unstubAllGlobals();
  });

  it("accepts a fenced ```json``` answer block", async () => {
    const fenced = "```json\n" + JSON.stringify(VALID_SUMMARY_ANSWER) + "\n```";
    const fetchMock = vi.fn(async () => okResponse(fenced));
    vi.stubGlobal("fetch", fetchMock);
    const res = await runLlmAgent(
      { messages: [{ role: "user", content: "go" }] },
      { provider: "openai", apiKey: "sk-test" },
    );
    expect(res.answer).toEqual(VALID_SUMMARY_ANSWER);
    vi.unstubAllGlobals();
  });
});

describe("runLlmAgent: tool loop", () => {
  it("executes a tool call, emits tool_progress, then final answer", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(toolCallResponse("call_1", "echo_tool", { message: "hi" }))
      .mockResolvedValueOnce(okResponse(JSON.stringify(VALID_SUMMARY_ANSWER)));
    vi.stubGlobal("fetch", fetchMock);
    const events: SinkEvent[] = [];
    const res = await runLlmAgent(
      { messages: [{ role: "user", content: "do thing" }] },
      { provider: "openai", apiKey: "sk-test" },
      (e) => events.push(e as SinkEvent),
    );
    expect(res.ok).toBe(true);
    expect(res.iterations).toBe(2);
    expect(res.answer).toEqual(VALID_SUMMARY_ANSWER);
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0]).toMatchObject({ tool: "echo_tool" });
    const tp = events.find((e) => e.type === "tool_progress");
    expect(tp).toBeTruthy();
    expect(tp?.tool).toBe("echo_tool");
    expect(typeof tp?.label).toBe("string");
    expect(events.find((e) => e.type === "answer")).toBeTruthy();
    expect(events[events.length - 1]?.type).toBe("done");
    vi.unstubAllGlobals();
  });

  it("sends response_format: json_object on every iteration (including tool-call turns)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(toolCallResponse("call_1", "echo_tool", { message: "hi" }))
      .mockResolvedValueOnce(okResponse(JSON.stringify(VALID_SUMMARY_ANSWER)));
    vi.stubGlobal("fetch", fetchMock);
    await runLlmAgent(
      { messages: [{ role: "user", content: "do thing" }] },
      { provider: "openai", apiKey: "sk-test" },
    );
    const firstBody = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    const secondBody = JSON.parse(fetchMock.mock.calls[1]![1]!.body as string);
    expect(firstBody.response_format).toEqual({ type: "json_object" });
    expect(secondBody.response_format).toEqual({ type: "json_object" });
    vi.unstubAllGlobals();
  });

  it("marks unknown tools as failed and continues", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(toolCallResponse("call_x", "no_such_tool", {}))
      .mockResolvedValueOnce(okResponse(JSON.stringify(VALID_SUMMARY_ANSWER)));
    vi.stubGlobal("fetch", fetchMock);
    const res = await runLlmAgent(
      { messages: [{ role: "user", content: "go" }] },
      { provider: "openai", apiKey: "sk-test" },
    );
    expect(res.ok).toBe(true);
    expect(res.toolCalls[0]).toMatchObject({ tool: "no_such_tool" });
    const r = res.toolCalls[0]!.result as { ok: boolean; error: string };
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unknown tool/);
    vi.unstubAllGlobals();
  });

  it("marks invalid tool arguments as failed", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(toolCallResponse("call_b", "echo_tool", { message: 42 }))
      .mockResolvedValueOnce(okResponse(JSON.stringify(VALID_SUMMARY_ANSWER)));
    vi.stubGlobal("fetch", fetchMock);
    const res = await runLlmAgent(
      { messages: [{ role: "user", content: "go" }] },
      { provider: "openai", apiKey: "sk-test" },
    );
    const r = res.toolCalls[0]!.result as { ok: boolean; error: string };
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/invalid arguments/);
    vi.unstubAllGlobals();
  });

  it("captures exceptions thrown by tool handlers", async () => {
    const tool = getEchoTool();
    tool.handler.mockImplementationOnce(async () => {
      throw new Error("boom");
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(toolCallResponse("call_e", "echo_tool", { message: "x" }))
      .mockResolvedValueOnce(okResponse(JSON.stringify(VALID_SUMMARY_ANSWER)));
    vi.stubGlobal("fetch", fetchMock);
    const res = await runLlmAgent(
      { messages: [{ role: "user", content: "go" }] },
      { provider: "openai", apiKey: "sk-test" },
    );
    const r = res.toolCalls[0]!.result as { ok: boolean; error: string };
    expect(r.ok).toBe(false);
    expect(r.error).toBe("boom");
    vi.unstubAllGlobals();
  });

  it("emits run_triggered when a tool result has runId", async () => {
    const tool = getEchoTool();
    tool.handler.mockImplementationOnce(async () => ({
      ok: true,
      runId: "run_abc",
      task: "crawl-queue-worker",
      crawlRunId: "crl_xyz",
      publicAccessToken: "pat_123",
    }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(toolCallResponse("call_t", "echo_tool", { message: "x" }))
      .mockResolvedValueOnce(okResponse(JSON.stringify(VALID_SUMMARY_ANSWER)));
    vi.stubGlobal("fetch", fetchMock);
    const events: SinkEvent[] = [];
    await runLlmAgent(
      { messages: [{ role: "user", content: "go" }] },
      { provider: "openai", apiKey: "sk-test" },
      (e) => events.push(e as SinkEvent),
    );
    const rt = events.find((e) => e.type === "run_triggered");
    expect(rt).toBeTruthy();
    expect(rt?.runId).toBe("run_abc");
    expect(rt?.task).toBe("crawl-queue-worker");
    expect(rt?.crawlRunId).toBe("crl_xyz");
    expect(rt?.publicAccessToken).toBe("pat_123");
    vi.unstubAllGlobals();
  });

  it("marks tool calls with bad-JSON arguments as failed", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(toolCallResponse("call_p", "echo_tool", "not-json"))
      .mockResolvedValueOnce(okResponse(JSON.stringify(VALID_SUMMARY_ANSWER)));
    vi.stubGlobal("fetch", fetchMock);
    const res = await runLlmAgent(
      { messages: [{ role: "user", content: "go" }] },
      { provider: "openai", apiKey: "sk-test" },
    );
    const r = res.toolCalls[0]!.result as { ok: boolean; error: string };
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/invalid arguments/);
    vi.unstubAllGlobals();
  });
});

describe("runLlmAgent: provider routing", () => {
  it("routes openrouter to openrouter.ai URL", async () => {
    let url = "";
    const fetchMock = vi.fn(async (u: string) => {
      url = u;
      return okResponse(JSON.stringify(VALID_SUMMARY_ANSWER));
    });
    vi.stubGlobal("fetch", fetchMock);
    await runLlmAgent(
      { messages: [{ role: "user", content: "x" }] },
      { provider: "openrouter", apiKey: "or-test" },
    );
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    vi.unstubAllGlobals();
  });

  it("routes minimax to api.minimax.io", async () => {
    let url = "";
    const fetchMock = vi.fn(async (u: string) => {
      url = u;
      return okResponse(JSON.stringify(VALID_SUMMARY_ANSWER));
    });
    vi.stubGlobal("fetch", fetchMock);
    await runLlmAgent(
      { messages: [{ role: "user", content: "x" }] },
      { provider: "minimax", apiKey: "mn-test" },
    );
    expect(url).toBe("https://api.minimax.io/v1/chat/completions");
    vi.unstubAllGlobals();
  });

  it("rejects anthropic provider (only OpenAI-compat APIs supported)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const events: SinkEvent[] = [];
    const res = await runLlmAgent(
      { messages: [{ role: "user", content: "go" }] },
      { provider: "anthropic", apiKey: "ak-test" },
      (e) => events.push(e as SinkEvent),
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/unsupported LLM provider.*anthropic/);
    expect(res.error).toMatch(/OpenAI-compatible/);
    expect(events.some((e) => e.type === "error" && String(e.error).startsWith("unsupported_provider"))).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("returns ok:false with unsupported-provider error", async () => {
    const res = await runLlmAgent(
      { messages: [{ role: "user", content: "x" }] },
      { provider: "nope", apiKey: "k" },
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/unsupported LLM provider/);
  });
});

describe("runLlmAgent: OpenAI retry policy", () => {
  it("retries transient HTTP 429 then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(okResponse(JSON.stringify(VALID_SUMMARY_ANSWER)));
    vi.stubGlobal("fetch", fetchMock);
    const res = await runLlmAgent(
      { messages: [{ role: "user", content: "x" }] },
      { provider: "openai", apiKey: "sk-test" },
    );
    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.unstubAllGlobals();
  });

  it("does not retry on non-transient 400", async () => {
    const fetchMock = vi.fn(async () => new Response("bad request", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await runLlmAgent(
      { messages: [{ role: "user", content: "x" }] },
      { provider: "openai", apiKey: "sk-test" },
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/HTTP 400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("retries on fetch transport error then returns error response after maxAttempts", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await runLlmAgent(
      { messages: [{ role: "user", content: "x" }] },
      { provider: "openai", apiKey: "sk-test" },
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/ECONNRESET/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.unstubAllGlobals();
  });

  it("emits error event when LLM call fails", async () => {
    const fetchMock = vi.fn(async () => new Response("server error", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const events: SinkEvent[] = [];
    const res = await runLlmAgent(
      { messages: [{ role: "user", content: "x" }] },
      { provider: "openai", apiKey: "sk-test" },
      (e) => events.push(e as SinkEvent),
    );
    expect(res.ok).toBe(false);
    expect(events.some((e) => e.type === "error")).toBe(true);
    vi.unstubAllGlobals();
  });

  it("logs the full request body (incl. messages) on non-transient HTTP failure", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => { /* swallow */ });
    const fetchMock = vi.fn(async () => new Response("bad request", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    await runLlmAgent(
      { messages: [{ role: "user", content: "hello" }] },
      { provider: "openai", apiKey: "sk-test" },
    );
    expect(errSpy).toHaveBeenCalled();
    const logged = errSpy.mock.calls.flat().map((c) => (typeof c === "string" ? c : JSON.stringify(c))).join("\n");
    expect(logged).toMatch(/requestBody/);
    expect(logged).toMatch(/hello/);
    errSpy.mockRestore();
    vi.unstubAllGlobals();
  });
});

describe("runLlmAgent: SSE chunk parsing", () => {
  it("accepts SSE-style data: prefixed chunks from the OpenAI-compatible API", async () => {
    const sseBody = [
      'data: {"choices":[{"message":{"role":"assistant","content":"' + JSON.stringify(VALID_SUMMARY_ANSWER).replace(/"/g, '\\"') + '"}}]}',
      "",
    ].join("\n");
    const fetchMock = vi.fn(async () => new Response(sseBody, { status: 200, headers: { "content-type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await runLlmAgent(
      { messages: [{ role: "user", content: "x" }] },
      { provider: "openai", apiKey: "sk-test" },
    );
    expect(res.ok).toBe(true);
    expect(res.answer).toEqual(VALID_SUMMARY_ANSWER);
    vi.unstubAllGlobals();
  });

  it("returns error when body has no choices", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await runLlmAgent(
      { messages: [{ role: "user", content: "x" }] },
      { provider: "openai", apiKey: "sk-test" },
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/upstream error|no chat.completion/i);
    vi.unstubAllGlobals();
  });
});

describe("runLlmAgent: default model selection", () => {
  it.each([
    ["openai", "gpt-4o-mini"],
    ["openrouter", "openai/gpt-4o-mini"],
    ["minimax", "MiniMax-M3"],
  ])("uses default model for provider=%s", async (provider, expectedModel) => {
    const fetchMock = vi.fn(async () => okResponse(JSON.stringify(VALID_SUMMARY_ANSWER)));
    vi.stubGlobal("fetch", fetchMock);
    const res = await runLlmAgent(
      { messages: [{ role: "user", content: "x" }] },
      { provider, apiKey: "k" },
    );
    expect(res.model).toBe(expectedModel);
    vi.unstubAllGlobals();
  });

  it("respects an explicit model in the request", async () => {
    const fetchMock = vi.fn(async () => okResponse(JSON.stringify(VALID_SUMMARY_ANSWER)));
    vi.stubGlobal("fetch", fetchMock);
    const res = await runLlmAgent(
      { messages: [{ role: "user", content: "x" }], model: "gpt-4o" },
      { provider: "openai", apiKey: "k" },
    );
    expect(res.model).toBe("gpt-4o");
    vi.unstubAllGlobals();
  });
});

describe("runLlmAgent: request body injection", () => {
  it("sends the WayfareAnswer system prompt + user messages to the provider", async () => {
    let sentBody: Record<string, unknown> | null = null;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      sentBody = JSON.parse(init.body as string);
      return okResponse(JSON.stringify(VALID_SUMMARY_ANSWER));
    });
    vi.stubGlobal("fetch", fetchMock);
    await runLlmAgent(
      { messages: [{ role: "user", content: "hello" }] },
      { provider: "openai", apiKey: "sk-test" },
    );
    expect(sentBody).not.toBeNull();
    const messages = sentBody!.messages as Array<{ role: string; content: string }>;
    expect(messages[0]!.role).toBe("system");
    expect(messages[0]!.content).toMatch(/WayfareAnswer/);
    expect(messages[messages.length - 1]).toEqual({ role: "user", content: "hello" });
    expect(sentBody!.tool_choice).toBe("auto");
    expect(sentBody!.stream).toBe(false);
    expect(Array.isArray(sentBody!.tools)).toBe(true);
    vi.unstubAllGlobals();
  });
});

describe("parseWayfareAnswer", () => {
  it("parses each kind of answer", () => {
    for (const obj of [
      { kind: "summary", text: "ok" },
      { kind: "question", text: "q?", suggestions: ["a", "b"] },
      { kind: "error", message: "bad" },
      { kind: "set_origin", iata: "DUB" },
      { kind: "destinations", origin: "DUB", arrows: [{ iata: "BCN", bestPrice: 19.99 }] },
      { kind: "cheapest_fares", origin: "DUB", window: { dateFrom: "2026-08-01", dateTo: "2026-08-31" }, deals: [{ iata: "BCN", bestPrice: 19.99 }] },
      { kind: "fares", iata: "DUB", fares: [{ origin: "DUB", destination: "BCN", price: 19.99, currency: "EUR", departureDate: "2026-08-01" }] },
      { kind: "fastest_routes", destination: "BCN", routes: [{ origin: "DUB", destination: "BCN", price: 30, currency: "EUR", durationMinutes: 165 }] },
      { kind: "origin_compare", destination: "BCN", rows: [{ origin: "DUB", price: 30, currency: "EUR" }] },
      { kind: "itineraries", itineraries: [{ id: "x", title: "Trip", totalPrice: 200, currency: "EUR", legs: [{ origin: "DUB", destination: "BCN", date: "2026-08-01", price: 100, currency: "EUR" }], summary: "ok", recommendationScore: 50 }] },
    ]) {
      expect(parseWayfareAnswer(JSON.stringify(obj)).ok).toBe(true);
    }
  });

  it("rejects invalid kinds and missing fields", () => {
    expect(parseWayfareAnswer(JSON.stringify({ kind: "weird" })).ok).toBe(false);
    expect(parseWayfareAnswer(JSON.stringify({ kind: "summary" })).ok).toBe(false);
    expect(parseWayfareAnswer("not json").ok).toBe(false);
    expect(parseWayfareAnswer("").ok).toBe(false);
  });

  it("rejects IATAs that aren't 3 letters", () => {
    expect(parseWayfareAnswer(JSON.stringify({ kind: "set_origin", iata: "DUBAI" })).ok).toBe(false);
    expect(parseWayfareAnswer(JSON.stringify({ kind: "cheapest_fares", origin: "DUBAI", window: { dateFrom: "2026-08-01", dateTo: "2026-08-31" }, deals: [{ iata: "BCN", bestPrice: 19 }] })).ok).toBe(false);
  });

  it("rejects non-ISO dates", () => {
    expect(parseWayfareAnswer(JSON.stringify({ kind: "cheapest_fares", origin: "DUB", window: { dateFrom: "Aug 1", dateTo: "2026-08-31" }, deals: [{ iata: "BCN" }] })).ok).toBe(false);
  });
});

describe("WayfareAnswerSchema", () => {
  it("is exported from client and matches the wayfare-answer module", () => {
    expect(WayfareAnswerSchema).toBeDefined();
  });
});

describe("key-vault resolveCredentials priority", () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.MINIMAX_API_KEY;
    delete process.env.MINIMAX_MODEL;
  });
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.MINIMAX_API_KEY;
    delete process.env.MINIMAX_MODEL;
  });

  it("prefers OPENAI_API_KEY over others", async () => {
    process.env.OPENAI_API_KEY = "sk-openai";
    process.env.MINIMAX_API_KEY = "mn-key";
    const { resolveCredentials } = await import("./key-vault.js");
    expect(resolveCredentials()).toEqual({
      provider: "openai",
      apiKey: "sk-openai",
      model: undefined,
      source: "env",
    });
  });

  it("falls back to openrouter when OPENAI missing", async () => {
    process.env.OPENROUTER_API_KEY = "or-key";
    const { resolveCredentials } = await import("./key-vault.js");
    const r = resolveCredentials();
    expect(r.provider).toBe("openrouter");
    expect(r.apiKey).toBe("or-key");
  });

  it("falls back to minimax with default model MiniMax-M3", async () => {
    process.env.MINIMAX_API_KEY = "mn-key";
    const { resolveCredentials } = await import("./key-vault.js");
    const r = resolveCredentials();
    expect(r.provider).toBe("minimax");
    expect(r.model).toBe("MiniMax-M3");
  });

  it("returns source:none when no key configured", async () => {
    const { resolveCredentials } = await import("./key-vault.js");
    const r = resolveCredentials();
    expect(r.source).toBe("none");
    expect(r.apiKey).toBe("");
  });
});
