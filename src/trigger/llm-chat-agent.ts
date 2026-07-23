import { logger, metadata, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";

import { runLlmAgent, type LlmStreamEvent } from "../llm/client.js";
import { resolveCredentials } from "../llm/key-vault.js";
import { TASK_DESCRIPTIONS } from "./task-descriptions.js";

export const LlmChatPayload = z.object({
  messages: z.array(z.object({
    role: z.enum(["system", "user", "assistant", "tool"]),
    content: z.string().nullable(),
    tool_calls: z.array(z.object({
      id: z.string(),
      name: z.string(),
      arguments: z.string(),
    })).optional(),
    tool_call_id: z.string().optional(),
    name: z.string().optional(),
  })),
  model: z.string().optional(),
  maxIterations: z.number().int().min(1).max(20).default(12),
});

export type LlmChatPayloadT = z.infer<typeof LlmChatPayload>;

function eventSink(event: LlmStreamEvent) {
  const logFn = event.type === "error" || event.type === "status"
    ? "warn"
    : "info";
  const log = logger[logFn] ?? logger.info;
  log(`[llm-agent] event`, {
    eventType: event.type,
    ...Object.fromEntries(
      Object.entries(event)
        .filter(([k]) => k !== "type")
        .map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : v]),
    ),
  });
}

export const llmChatAgent = schemaTask({
  id: "llm-chat-agent",
  description: TASK_DESCRIPTIONS["llm-chat-agent"]?.summary ?? "Chat with Wayfare AI assistant",
  schema: LlmChatPayload,
  maxDuration: 900,
  ttl: "15m",
  queue: { concurrencyLimit: 1 },
  retry: { maxAttempts: 2 },
  run: async (payload) => {
    metadata.set("task", "llm-chat-agent");
    metadata.set("iterations", payload.maxIterations);

    const creds = resolveCredentials();
    logger.info("llm-chat-agent starting", {
      provider: creds.provider,
      model: creds.model ?? "default",
      messageCount: payload.messages.length,
      maxIterations: payload.maxIterations,
    });

    const result = await runLlmAgent(
      {
        messages: payload.messages,
        model: payload.model,
        maxIterations: payload.maxIterations,
      },
      { provider: creds.provider, apiKey: creds.apiKey, model: creds.model },
      eventSink,
    );

    logger.info("llm-chat-agent finished", {
      ok: result.ok,
      iterations: result.iterations,
      answerKind: result.answer?.kind ?? null,
      toolCallsCount: result.toolCalls.length,
      error: result.error ?? null,
    });

    return {
      ok: result.ok,
      provider: result.provider,
      model: result.model,
      answer: result.answer,
      toolCalls: result.toolCalls,
      iterations: result.iterations,
      source: result.source,
      error: result.error ?? null,
    };
  },
});
