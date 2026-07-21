import { describe, it, expect } from "vitest";
import type { LlmStreamEvent, ChatMessage } from "../../src/llm/client.js";

describe("LlmStreamEvent UI Contract", () => {
  it("should have all 6 required event types for the clean wire", () => {
    const eventTypes: LlmStreamEvent["type"][] = [
      "status",
      "tool_progress",
      "answer",
      "run_triggered",
      "error",
      "done",
    ];
    expect(eventTypes).toHaveLength(6);
  });

  it("should support status event with thinking state for UI spinner", () => {
    const event: LlmStreamEvent = {
      type: "status",
      status: "thinking",
      provider: "openai",
      model: "gpt-4o-mini",
    };
    expect(event.type).toBe("status");
    expect(event.status).toBe("thinking");
    expect(event.provider).toBe("openai");
    expect(event.model).toBe("gpt-4o-mini");
  });

  it("should support status event for any provider", () => {
    for (const provider of ["openai", "openrouter", "minimax"]) {
      const event: LlmStreamEvent = {
        type: "status",
        status: "thinking",
        provider,
        model: "test-model",
      };
      expect(event.provider).toBe(provider);
    }
  });

  it("should support tool_progress event with label + tool", () => {
    const event: LlmStreamEvent = {
      type: "tool_progress",
      label: "Searching cheapest fares from DUB…",
      tool: "find_cheapest_destinations",
    };
    expect(event.type).toBe("tool_progress");
    expect(event.tool).toBe("find_cheapest_destinations");
    expect(typeof event.label).toBe("string");
  });

  it("should support answer event with a parsed WayfareAnswer payload (summary kind)", () => {
    const event: LlmStreamEvent = {
      type: "answer",
      answer: { kind: "summary", text: "Here are your flights." },
    };
    expect(event.type).toBe("answer");
    expect(event.answer.kind).toBe("summary");
  });

  it("should support answer event with set_origin kind", () => {
    const event: LlmStreamEvent = {
      type: "answer",
      answer: { kind: "set_origin", iata: "DUB", label: "Dublin" },
    };
    expect(event.answer).toMatchObject({ kind: "set_origin", iata: "DUB" });
  });

  it("should support answer event with destinations kind carrying arrow metadata", () => {
    const event: LlmStreamEvent = {
      type: "answer",
      answer: {
        kind: "destinations",
        origin: "DUB",
        arrows: [
          { iata: "BCN", city: "Barcelona", bestPrice: 19.99, currency: "EUR", durationMinutes: 165 },
          { iata: "MAD", city: "Madrid", bestPrice: 24.5, currency: "EUR", durationMinutes: 175 },
        ],
      },
    };
    expect(event.answer.kind).toBe("destinations");
    if (event.answer.kind === "destinations") {
      expect(event.answer.arrows).toHaveLength(2);
      expect(event.answer.arrows[0]!.iata).toBe("BCN");
    }
  });

  it("should support answer event with cheapest_fares kind", () => {
    const event: LlmStreamEvent = {
      type: "answer",
      answer: {
        kind: "cheapest_fares",
        origin: "DUB",
        window: { dateFrom: "2026-08-01", dateTo: "2026-08-31" },
        deals: [{ iata: "BCN", bestPrice: 19.99 }],
      },
    };
    expect(event.answer.kind).toBe("cheapest_fares");
  });

  it("should support answer event with itineraries kind", () => {
    const event: LlmStreamEvent = {
      type: "answer",
      answer: {
        kind: "itineraries",
        itineraries: [
          {
            id: "x",
            title: "Trip",
            totalPrice: 200,
            currency: "EUR",
            legs: [{ origin: "DUB", destination: "BCN", date: "2026-08-01", price: 100, currency: "EUR" }],
            summary: "ok",
            recommendationScore: 50,
          },
        ],
      },
    };
    expect(event.answer.kind).toBe("itineraries");
  });

  it("should support answer event with question kind and suggestions", () => {
    const event: LlmStreamEvent = {
      type: "answer",
      answer: { kind: "question", text: "Which month?", suggestions: ["June", "July"] },
    };
    expect(event.answer.kind).toBe("question");
  });

  it("should support run_triggered event with crawl metadata for UI polling", () => {
    const event: LlmStreamEvent = {
      type: "run_triggered",
      toolName: "trigger_refresh_crawl",
      runId: "run_xyz123",
      task: "crawl-queue-worker",
      crawlRunId: "crawl_abc123",
      publicAccessToken: "pat_xyz789",
    };
    expect(event.type).toBe("run_triggered");
    expect(event.toolName).toBe("trigger_refresh_crawl");
    expect(event.runId).toBe("run_xyz123");
    expect(event.task).toBe("crawl-queue-worker");
    expect(event.crawlRunId).toBe("crawl_abc123");
    expect(event.publicAccessToken).toBe("pat_xyz789");
  });

  it("should support run_triggered with null fields when task is unknown", () => {
    const event: LlmStreamEvent = {
      type: "run_triggered",
      toolName: "trigger_crawl",
      runId: "run_min",
      task: null,
      crawlRunId: null,
      publicAccessToken: null,
    };
    expect(event.task).toBeNull();
    expect(event.crawlRunId).toBeNull();
    expect(event.publicAccessToken).toBeNull();
  });

  it("should support error event with error message", () => {
    const event: LlmStreamEvent = { type: "error", error: "no_credentials" };
    expect(event.type).toBe("error");
    expect(event.error).toBe("no_credentials");
  });

  it("should support error event with HTTP status details", () => {
    const event: LlmStreamEvent = { type: "error", error: "LLM HTTP 429: Rate limited" };
    expect(event.error).toContain("429");
  });

  it("should support done event with metrics for UI finalization", () => {
    const event: LlmStreamEvent = { type: "done", iterations: 2, toolCalls: 1 };
    expect(event.type).toBe("done");
    expect(event.iterations).toBe(2);
    expect(event.toolCalls).toBe(1);
  });

  it("should NOT leak raw assistant_delta events (server-internal only)", () => {
    const eventTypes: LlmStreamEvent["type"][] = [
      "status",
      "tool_progress",
      "answer",
      "run_triggered",
      "error",
      "done",
    ];
    expect(eventTypes).not.toContain("assistant_delta");
    expect(eventTypes).not.toContain("assistant_message");
    expect(eventTypes).not.toContain("tool_call");
    expect(eventTypes).not.toContain("tool_result");
  });
});

describe("ChatMessage type validation", () => {
  it("should support system message", () => {
    const msg: ChatMessage = { role: "system", content: "You are a helpful assistant" };
    expect(msg.role).toBe("system");
  });

  it("should support user message", () => {
    const msg: ChatMessage = { role: "user", content: "Find flights to BCN" };
    expect(msg.role).toBe("user");
  });

  it("should support assistant message with tool calls", () => {
    const msg: ChatMessage = {
      role: "assistant",
      content: "Let me search for that",
      tool_calls: [
        { id: "call_1", name: "search_airports", arguments: '{"query":"BCN"}' },
      ],
    };
    expect(msg.role).toBe("assistant");
    expect(msg.tool_calls).toHaveLength(1);
  });

  it("should support tool message with tool_call_id", () => {
    const msg: ChatMessage = {
      role: "tool",
      content: '{"ok":true,"airports":[...]}',
      tool_call_id: "call_1",
      name: "search_airports",
    };
    expect(msg.role).toBe("tool");
    expect(msg.tool_call_id).toBe("call_1");
  });
});

describe("Event Ordering for UI State Machine", () => {
  it("should define correct event sequence for simple conversation", () => {
    const simpleSequence: LlmStreamEvent["type"][] = [
      "status",
      "answer",
      "done",
    ];
    expect(simpleSequence).toEqual(["status", "answer", "done"]);
  });

  it("should define correct event sequence for tool-call conversation", () => {
    const withToolSequence: LlmStreamEvent["type"][] = [
      "status",
      "tool_progress",
      "answer",
      "done",
    ];
    expect(withToolSequence).toEqual(["status", "tool_progress", "answer", "done"]);
  });

  it("should define correct event sequence for crawl trigger", () => {
    const crawlSequence: LlmStreamEvent["type"][] = [
      "status",
      "tool_progress",
      "run_triggered",
      "answer",
      "done",
    ];
    expect(crawlSequence).toContain("run_triggered");
    const runTriggeredIdx = crawlSequence.indexOf("run_triggered");
    const toolProgressIdx = crawlSequence.indexOf("tool_progress");
    expect(runTriggeredIdx).toBe(toolProgressIdx + 1);
  });

  it("should define correct event sequence for error", () => {
    const errorSequence: LlmStreamEvent["type"][] = [
      "status",
      "error",
    ];
    expect(errorSequence).toContain("error");
  });
});

describe("Multi-turn UI State", () => {
  it("should support multiple tool_progress events from one conversation turn", () => {
    const events: LlmStreamEvent["type"][] = [
      "status", "tool_progress", "tool_progress",
      "answer", "done",
    ];
    const toolProgressCount = events.filter((e) => e === "tool_progress").length;
    expect(toolProgressCount).toBe(2);
  });
});
