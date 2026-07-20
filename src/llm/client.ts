import { logger } from "../lib/logger";
import { listTools, getTool, type ToolDefinition } from "../trigger/tools/registry";

const log = logger("src/llm/client.ts");

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{ id: string; name: string; arguments: string }>;
  tool_call_id?: string;
  name?: string;
}

export interface LlmChatRequest {
  messages: ChatMessage[];
  model?: string;
  maxIterations?: number;
  userId?: string;
}

export interface LlmStreamEvent {
  type:
    | "status"
    | "assistant_delta"
    | "tool_call"
    | "tool_result"
    | "assistant_message"
    | "run_triggered"
    | "error"
    | "done";
  [key: string]: unknown;
}

export type LlmStreamSink = (event: LlmStreamEvent) => void;

export interface LlmChatResponse {
  ok: boolean;
  provider: string;
  model: string;
  content: string | null;
  toolCalls: Array<{ tool: string; arguments: unknown; result: unknown }>;
  iterations: number;
  source: "byok" | "env" | "none";
  error?: string;
}

const SYSTEM_PROMPT = `You are Wayfare, a travel-planning assistant for the Hackathron trip planner.
You help users plan flights between European airports that are crawled from Ryanair (and optionally EasyJet).
You have a rich set of tools. Pick the right one based on the user's question:

- "Where can I fly cheaply from X?" → \`find_cheapest_destinations\` (inspiration, ranked by best fare per destination in the window).
- "When is the cheapest day to fly X→Y?" → \`find_cheapest_dates\` (cheapest one-way per date, full window).
- "Cheapest one-way tickets X→Y" → \`find_best_one_way\` (K cheapest fares, price-asc).
- "Cheapest round trip A↔B for an N-day trip" → \`find_best_round_trip\` (self-joined, ranked by total).
- "Cheap weekend in BCN" / "long weekend" → \`find_weekend_deals\` (Fri-Sun departure/return only).
- "From any London airport" → \`find_cheapest_from_any_origin\` (pass multiple origins, server picks best + alternatives).
- "All fares from X" → \`get_airport_fares\`.
- "Round trip A↔B (legacy TS pairing)" → \`plan_round_trip\`.
- "Multi-stop trip through several cities" → \`plan_multi_stop\` (single-shot SQL planner across all permutations).
- Before quoting prices, call \`get_dataset_freshness\` and respect its warnings; if data is older than 48h, mention the freshness window to the user.

Always call the relevant tool rather than guessing. Cite prices and dates from the tool output.
Prefer round-trip itineraries when the user asks for a holiday. Use multi-stop when they list multiple destinations.
If pricing data is missing for a leg or destination, call \`trigger_refresh_crawl\` FIRST so the crawl actually runs (the tool both enqueues the work AND fires the queue worker); then either retry the lookup or recommend the user wait for results.
All LLM calls are routed through our hosting service — there is no per-user key. The Trigger.dev tasks you fire (crawl-queue-worker / crawl-pending-item) will run to completion and the frontend will be updated in realtime with their status.
Be concise. Output should be 2–6 short paragraphs max.`;

function toOpenAiTools(): Array<Record<string, unknown>> {
  return listTools().map((t: ToolDefinition) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

function toAnthropicTools(): Array<Record<string, unknown>> {
  return listTools().map((t: ToolDefinition) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

export async function runLlmAgent(
  req: LlmChatRequest,
  creds: { provider: string; apiKey: string; model?: string },
  sink?: LlmStreamSink,
): Promise<LlmChatResponse> {
  const provider = creds.provider || "openai";
  const model = req.model || creds.model || defaultModel(provider);
  const maxIterations = Math.max(1, Math.min(10, req.maxIterations ?? 6));
  const toolCalls: LlmChatResponse["toolCalls"] = [];
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...req.messages,
  ];
  const emit = (e: LlmStreamEvent) => { if (sink) try { sink(e); } catch { /* ignore */ } };

  if (!creds.apiKey) {
    emit({ type: "error", error: "no_credentials" });
    return {
      ok: false,
      provider,
      model,
      content: null,
      toolCalls,
      iterations: 0,
      source: "none",
      error:
        "No LLM credentials configured. Set OPENAI_API_KEY (or ANTHROPIC_API_KEY / OPENROUTER_API_KEY / MINIMAX_API_KEY) on the server.",
    };
  }
  emit({ type: "status", status: "thinking", provider, model });

  let iterations = 0;
  let finalContent: string | null = null;

  while (iterations < maxIterations) {
    iterations += 1;
    let raw: Record<string, unknown>;
    try {
      raw = await callProvider(provider, { apiKey: creds.apiKey, model, messages });
    } catch (err) {
      log.warn("LLM call failed", { provider, error: (err as Error).message });
      emit({ type: "error", error: (err as Error).message });
      return {
        ok: false,
        provider,
        model,
        content: null,
        toolCalls,
        iterations,
        source: "env",
        error: (err as Error).message,
      };
    }

    const assistantMessage = raw.assistantMessage as ChatMessage;
    messages.push(assistantMessage);
    finalContent = typeof assistantMessage.content === "string" ? assistantMessage.content : finalContent;
    if (typeof assistantMessage.content === "string" && assistantMessage.content) {
      emit({ type: "assistant_delta", content: assistantMessage.content });
    }
    emit({ type: "assistant_message", content: assistantMessage.content, toolCalls: assistantMessage.tool_calls ?? [] });

    const calls = assistantMessage.tool_calls ?? [];
    if (calls.length === 0) break;

    for (const call of calls) {
      let parsedArgs: unknown;
      try {
        parsedArgs = JSON.parse(call.arguments);
      } catch {
        parsedArgs = call.arguments;
      }
      const tool = getToolByName(call.name);
      emit({ type: "tool_call", id: call.id, name: call.name, arguments: parsedArgs });
      let result: unknown;
      let toolError: string | undefined;
      if (!tool) {
        toolError = `unknown tool: ${call.name}`;
        result = { ok: false, error: toolError };
      } else {
        const parsed = tool.schema.safeParse(parsedArgs);
        if (!parsed.success) {
          toolError = `invalid arguments: ${JSON.stringify(parsed.error.issues)}`;
          result = { ok: false, error: toolError };
        } else {
          try {
            result = await tool.handler(parsed.data);
          } catch (err) {
            toolError = (err as Error).message;
            result = { ok: false, error: toolError };
          }
        }
      }
      toolCalls.push({ tool: call.name, arguments: parsedArgs, result });

      if (result && typeof result === "object") {
        const r = result as Record<string, unknown>;
        if (r.runId && typeof r.runId === "string") {
          emit({
            type: "run_triggered",
            toolId: call.id,
            toolName: call.name,
            runId: r.runId,
            task: typeof r.task === "string" ? r.task : null,
            crawlRunId: typeof r.crawlRunId === "string" ? r.crawlRunId : null,
            publicAccessToken: typeof r.publicAccessToken === "string" ? r.publicAccessToken : null,
          });
        }
      }

      emit({ type: "tool_result", id: call.id, name: call.name, result });
      messages.push({
        role: "tool",
        content: typeof result === "string" ? result : JSON.stringify(result),
        tool_call_id: call.id,
        name: call.name,
      });
    }
  }

  emit({ type: "done", iterations, toolCalls: toolCalls.length });

  return {
    ok: true,
    provider,
    model,
    content: finalContent,
    toolCalls,
    iterations,
    source: "env",
  };
}

function getToolByName(name: string): ToolDefinition | null {
  for (const t of listTools()) if (t.name === name) return t;
  return null;
}

function defaultModel(provider: string): string {
  if (provider === "anthropic") return "claude-3-5-sonnet-latest";
  if (provider === "openrouter") return "openai/gpt-4o-mini";
  return "gpt-4o-mini";
}

interface CallArgs {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
}

async function callProvider(provider: string, args: CallArgs): Promise<{ assistantMessage: ChatMessage }> {
  if (provider === "openai" || provider === "openrouter" || provider === "minimax") {
    const url = provider === "openrouter"
      ? "https://openrouter.ai/api/v1/chat/completions"
      : provider === "minimax"
      ? "https://api.minimax.chat/v1/chat/completions"
      : "https://api.openai.com/v1/chat/completions";
    const body = {
      model: args.model,
      messages: args.messages,
      tools: toOpenAiTools(),
      tool_choice: "auto",
    };
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${args.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
    const data = (await res.json()) as { choices: Array<{ message: ChatMessage }> };
    const message = data.choices[0]?.message;
    if (!message) throw new Error("LLM returned no choices");
    return { assistantMessage: message };
  }

  if (provider === "anthropic") {
    const system = args.messages.find((m) => m.role === "system")?.content ?? "";
    const nonSystem = args.messages.filter((m) => m.role !== "system");
    const body = {
      model: args.model,
      max_tokens: 2048,
      system,
      messages: nonSystem.map(toAnthropicMessage),
      tools: toAnthropicTools(),
    };
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": args.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
    const data = (await res.json()) as {
      content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
      stop_reason?: string;
    };
    return fromAnthropicResponse(data);
  }

  throw new Error(`unsupported LLM provider: ${provider}`);
}

function toAnthropicMessage(m: ChatMessage): Record<string, unknown> {
  if (m.role === "tool") {
    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: m.tool_call_id,
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? null),
        },
      ],
    };
  }
  if (m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0) {
    const blocks: Array<Record<string, unknown>> = [];
    if (m.content) blocks.push({ type: "text", text: m.content });
    for (const call of m.tool_calls) {
      blocks.push({
        type: "tool_use",
        id: call.id,
        name: call.name,
        input: (() => { try { return JSON.parse(call.arguments); } catch { return {}; } })(),
      });
    }
    return { role: "assistant", content: blocks };
  }
  return { role: m.role, content: m.content ?? "" };
}

function fromAnthropicResponse(data: {
  content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
  stop_reason?: string;
}): { assistantMessage: ChatMessage } {
  const toolCalls: Array<{ id: string; name: string; arguments: string }> = [];
  let text: string | null = null;
  for (const block of data.content) {
    if (block.type === "text" && block.text) {
      text = text ? `${text}\n${block.text}` : block.text;
    } else if (block.type === "tool_use" && block.id && block.name) {
      toolCalls.push({ id: block.id, name: block.name, arguments: JSON.stringify(block.input ?? {}) });
    }
  }
  const message: ChatMessage = {
    role: "assistant",
    content: text,
  };
  if (toolCalls.length > 0) message.tool_calls = toolCalls;
  return { assistantMessage: message };
}