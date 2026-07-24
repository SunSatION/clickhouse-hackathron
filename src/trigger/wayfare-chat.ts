import { logger, metadata } from "@trigger.dev/sdk";
import { chat } from "@trigger.dev/sdk/ai";
import type { ModelMessage, UIMessageChunk } from "ai";
import { z } from "zod";

import {
  runLlmAgent,
  describeToolCall,
  type ChatMessage,
  type LlmChatParameters,
} from "../llm/client.js";
import { resolveCredentials } from "../llm/key-vault.js";
import type { WayfareAnswer } from "../llm/wayfare-answer.js";
import { TASK_DESCRIPTIONS } from "./task-descriptions.js";

/**
 * Trigger.dev `chat.agent` proxy that fronts the existing custom LLM loop in
 * `src/llm/client.ts` (the `llm-chat-agent` schemaTask uses the same helper).
 *
 * Why a proxy rather than a full migration:
 * - The existing custom client owns the WayfareAnswer JSON schema, the
 *   home-location / session-config context builders, and the OpenAI-compatible
 *   provider dance (openai / openrouter / minimax). It is the documented
 *   fallback per the project's `trigger_dev_chat_agent_for_competition`
 *   decision — keep it intact and reachable from a Trigger-native surface.
 * - This task is the native surface. It uses the SDK's chat.agent lifecycle
 *   (Sessions, idle suspend/resume, continuation, transport) and writes the
 *   structured `WayfareAnswer` back as a persisted `data-wayfare-answer`
 *   chunk so the existing UI handler can render it without code changes.
 * - A future migration can swap the body of `run()` for a Vercel AI SDK
 *   `streamText` loop that declares the tool set directly — no client.ts
 *   changes required by callers.
 */
const ClientDataSchema = z.object({
  model: z.string().optional(),
  maxIterations: z.number().int().min(1).max(20).default(12),
  homeIata: z.string().regex(/^[A-Za-z]{3}$/).optional(),
  parameters: z
    .object({
      origin: z.string().optional(),
      destination: z.string().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      passengers: z.number().optional(),
      maxPrice: z.number().optional(),
      mode: z.string().optional(),
      planner: z.string().optional(),
      maxItineraries: z.number().optional(),
      daysPerStop: z.number().optional(),
      flexDays: z.number().optional(),
      minDays: z.number().optional(),
      maxDays: z.number().optional(),
      homeIata: z.string().optional(),
    })
    .partial()
    .optional(),
  homeLocation: z
    .object({
      ip: z.string().optional(),
      country: z.string().optional(),
      lat: z.number().optional(),
      lon: z.number().optional(),
    })
    .partial()
    .optional(),
});

type WayfareChatClientData = z.infer<typeof ClientDataSchema>;

type ToolCallShape = NonNullable<ChatMessage["tool_calls"]>[number];

function isTextPart(part: unknown): part is { type: "text"; text: string } {
  return (
    typeof part === "object" &&
    part !== null &&
    (part as { type?: unknown }).type === "text" &&
    typeof (part as { text?: unknown }).text === "string"
  );
}

function isToolCallPart(part: unknown): part is {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  input: unknown;
} {
  return (
    typeof part === "object" &&
    part !== null &&
    (part as { type?: unknown }).type === "tool-call"
  );
}

function readStringContent(content: ModelMessage["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(isTextPart)
    .map((p) => p.text)
    .join("\n")
    .trim();
}

function modelMessagesToChat(messages: ModelMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      continue;
    }
    if (m.role === "user") {
      const text = readStringContent(m.content);
      if (text) out.push({ role: "user", content: text });
      continue;
    }
    if (m.role === "assistant") {
      const text = readStringContent(m.content);
      const toolCalls: ToolCallShape[] = (Array.isArray(m.content) ? m.content : [])
        .filter(isToolCallPart)
        .map((p) => ({
          id: p.toolCallId,
          type: "function",
          function: {
            name: p.toolName,
            arguments: JSON.stringify(p.input ?? {}),
          },
        }));
      if (!text && toolCalls.length === 0) continue;
      out.push({
        role: "assistant",
        content: text || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      });
      continue;
    }
  }
  return out;
}

function shortAnswerText(answer: WayfareAnswer): string {
  switch (answer.kind) {
    case "summary":
      return answer.text;
    case "question":
      return answer.suggestions?.length
        ? `${answer.text}\n\nTry: ${answer.suggestions.join(" • ")}`
        : answer.text;
    case "error":
      return `Sorry — ${answer.message}`;
    case "set_origin":
      return `Origin set to ${answer.iata}${answer.label ? ` (${answer.label})` : ""}.`;
    case "destinations": {
      const top = answer.arrows
        .slice(0, 5)
        .map((a) => `${a.iata} €${a.bestPrice ?? "?"} via ${a.bestAirline ?? "?"}`)
        .join(", ");
      return `Reachable from ${answer.origin}: ${top}${answer.arrows.length > 5 ? " …" : ""}`;
    }
    case "cheapest_fares": {
      const top = answer.deals
        .slice(0, 5)
        .map((a) => `${a.iata} €${a.bestPrice ?? "?"} on ${a.bestDate ?? "?"}`)
        .join(", ");
      return `Cheapest from ${answer.origin}: ${top}${answer.deals.length > 5 ? " …" : ""}`;
    }
    case "fares":
      return `${answer.fares.length} fare(s) for ${answer.iata}.`;
    case "fastest_routes": {
      const top = answer.routes[0];
      return top
        ? `Fastest to ${answer.destination}: ${top.origin} → ${top.destination} in ${top.durationMinutes}min (€${top.price})`
        : `Fastest routes to ${answer.destination}: no matches.`;
    }
    case "origin_compare": {
      const top = answer.rows[0];
      return top
        ? `Best origin to ${answer.destination}: ${top.origin} (€${top.price}${top.durationMinutes ? `, ${top.durationMinutes}min` : ""})`
        : `Origin comparison for ${answer.destination}: no matches.`;
    }
    case "itineraries": {
      const top = answer.itineraries[0];
      return top
        ? `Itinerary: ${top.title} — €${top.totalPrice} (${top.legs.length} legs)`
        : `No itineraries returned.`;
    }
    default:
      return "Done.";
  }
}

export const wayfareChat = chat.agent({
  id: "wayfare-chat",
  description:
    TASK_DESCRIPTIONS["llm-chat-agent"]?.summary ?? "Wayfare chat proxy",
  clientDataSchema: ClientDataSchema,
  run: async ({ messages, clientData, chatId }) => {
    metadata.set("chat.proxy", "wayfare-chat → runLlmAgent");
    metadata.set("chat.chatId", chatId);

    const data: WayfareChatClientData = clientData ?? { maxIterations: 12 };
    const creds = resolveCredentials();

    if (!creds.apiKey) {
      logger.error("wayfare-chat: no LLM credentials configured", {
        provider: creds.provider,
      });
      throw new Error(
        "No LLM credentials configured. Set OPENAI_API_KEY (or OPENROUTER_API_KEY / MINIMAX_API_KEY) on the server.",
      );
    }

    const chatMessages = modelMessagesToChat(messages);
    logger.info("wayfare-chat: proxy turn start", {
      provider: creds.provider,
      model: data.model ?? creds.model ?? "default",
      chatId,
      historyMessages: chatMessages.length,
      maxIterations: data.maxIterations,
    });

    let lastError: string | null = null;

    const result = await runLlmAgent(
      {
        messages: chatMessages,
        model: data.model,
        maxIterations: data.maxIterations,
        homeIata: data.homeIata,
        parameters: data.parameters as LlmChatParameters | undefined,
        homeLocation: data.homeLocation,
      },
      { provider: creds.provider, apiKey: creds.apiKey, model: creds.model },
      (event) => {
        if (event.type === "tool_progress") {
          const chunk: UIMessageChunk = {
            type: "data-wayfare-tool",
            data: { tool: event.tool, label: event.label },
            transient: true,
          };
          chat.response.write(chunk);
          return;
        }
        if (event.type === "run_triggered") {
          const chunk: UIMessageChunk = {
            type: "data-wayfare-run",
            data: {
              tool: event.toolName,
              runId: event.runId,
              task: event.task,
              crawlRunId: event.crawlRunId,
            },
            transient: true,
          };
          chat.response.write(chunk);
          return;
        }
        if (event.type === "error") {
          lastError = event.error;
          chat.response.write({
            type: "data-wayfare-error",
            data: { error: event.error },
            transient: true,
          });
          return;
        }
      },
    );

    metadata.set("chat.iterations", result.iterations);
    metadata.set("chat.toolCalls", result.toolCalls.length);
    metadata.set("chat.answerKind", result.answer?.kind ?? "error");
    metadata.set("chat.ok", result.ok);

    logger.info("wayfare-chat: proxy turn complete", {
      ok: result.ok,
      iterations: result.iterations,
      toolCalls: result.toolCalls.length,
      answerKind: result.answer?.kind ?? null,
      error: result.error ?? null,
    });

    if (!result.ok || !result.answer) {
      const errMsg = result.error ?? lastError ?? "no answer produced";
      chat.response.write({
        type: "data-wayfare-answer",
        data: { kind: "error", message: errMsg } satisfies WayfareAnswer,
      });
      throw new Error(errMsg);
    }

    chat.response.write({
      type: "data-wayfare-answer",
      data: result.answer,
    });

    const reply = shortAnswerText(result.answer);
    const messageId = `wayfare-${Date.now()}-${chatId.slice(-6)}`;

    chat.response.write({ type: "text-start", id: messageId });
    chat.response.write({ type: "text-delta", id: messageId, delta: reply });
    chat.response.write({ type: "text-end", id: messageId });

    for (const tc of result.toolCalls) {
      chat.response.write({
        type: "data-wayfare-tool-summary",
        data: {
          tool: tc.tool,
          label: describeToolCall(tc.tool, tc.arguments).label,
          ok:
            tc.result &&
            typeof tc.result === "object" &&
            (tc.result as { ok?: unknown }).ok !== false,
        },
        transient: true,
      });
    }
  },
});
