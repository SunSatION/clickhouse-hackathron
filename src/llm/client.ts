import { logger } from "../lib/logger.js";
import { listTools, getTool, type ToolDefinition } from "../trigger/tools/registry.js";
import {
  WayfareAnswerSchema,
  WAYFARE_ANSWER_JSON_SCHEMA,
  WAYFARE_ANSWER_SYSTEM_PROMPT,
  parseWayfareAnswer,
  type WayfareAnswer,
} from "./wayfare-answer.js";

const log = logger("src/llm/client.ts");

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type?: string;
    name?: string;
    arguments?: string;
    function?: { name?: string; arguments?: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

export interface LlmChatRequest {
  messages: ChatMessage[];
  model?: string;
  maxIterations?: number;
  userId?: string;
  homeIata?: string;
  homeLocation?: {
    ip?: string;
    country?: string;
    lat?: number;
    lon?: number;
  };
}

export type LlmStreamEvent =
  | { type: "status"; status: "thinking" | "answering"; provider: string; model: string }
  | { type: "tool_progress"; label: string; tool: string }
  | { type: "answer"; answer: WayfareAnswer }
  | { type: "run_triggered"; toolName: string; runId: string; task: string | null; crawlRunId: string | null; publicAccessToken: string | null }
  | { type: "error"; error: string }
  | { type: "done"; iterations: number; toolCalls: number };

export type LlmStreamSink = (event: LlmStreamEvent) => void;

export interface LlmChatResponse {
  ok: boolean;
  provider: string;
  model: string;
  answer: WayfareAnswer | null;
  toolCalls: Array<{ tool: string; arguments: unknown; result: unknown }>;
  iterations: number;
  source: "byok" | "env" | "none";
  error?: string;
}

function buildHomeLocationContext(hl: NonNullable<LlmChatRequest["homeLocation"]>, homeIata?: string): ChatMessage[] {
  const parts: string[] = ["[HOME LOCATION CONTEXT]"];
  if (homeIata) parts.push(`Saved home airport (user setting #set-home): ${homeIata.toUpperCase()} — pass this as the 'iata' parameter to get_home_airport`);
  if (hl.country) parts.push(`User country: ${hl.country.toUpperCase()}`);
  if (hl.lat != null && hl.lon != null) parts.push(`Browser geolocation: lat=${hl.lat.toFixed(4)}, lon=${hl.lon.toFixed(4)}`);
  if (hl.ip) parts.push(`IP address: ${hl.ip}`);
  parts.push("Priority order for get_home_airport: (1) saved home airport IATA, (2) browser geolocation → reverse geocode, (3) IP geolocation. Always call get_home_airport first if the user has not specified an origin.");
  return [{ role: "system", content: parts.join(" | ") }];
}

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
    { role: "system", content: WAYFARE_ANSWER_SYSTEM_PROMPT },
    ...(req.homeLocation || req.homeIata ? buildHomeLocationContext(req.homeLocation ?? {}, req.homeIata) : []),
    ...req.messages,
  ];
  const emit = (e: LlmStreamEvent) => {
    if (sink) try { sink(e); } catch { /* ignore */ }
  };

  if (!["openai", "openrouter", "minimax"].includes(provider)) {
    emit({ type: "error", error: `unsupported_provider: ${provider}` });
    return {
      ok: false,
      provider,
      model,
      answer: null,
      toolCalls,
      iterations: 0,
      source: creds.apiKey ? "env" : "none",
      error: `unsupported LLM provider: ${provider}. Only OpenAI-compatible APIs are supported (openai, openrouter, minimax).`,
    };
  }

  if (!creds.apiKey) {
    emit({ type: "error", error: "no_credentials" });
    return {
      ok: false,
      provider,
      model,
      answer: null,
      toolCalls,
      iterations: 0,
      source: "none",
      error:
        "No LLM credentials configured. Set OPENAI_API_KEY (or OPENROUTER_API_KEY / MINIMAX_API_KEY) on the server.",
    };
  }
  emit({ type: "status", status: "thinking", provider, model });

  let iterations = 0;
  let finalAnswer: WayfareAnswer | null = null;

  while (iterations < maxIterations) {
    iterations += 1;
    let raw: Record<string, unknown>;
    try {
      raw = await callProvider(provider, { apiKey: creds.apiKey, model, messages, forceJsonObject: true });
    } catch (err) {
      log.warn("LLM call failed", { provider, error: (err as Error).message });
      emit({ type: "error", error: (err as Error).message });
      return {
        ok: false,
        provider,
        model,
        answer: null,
        toolCalls,
        iterations,
        source: "env",
        error: (err as Error).message,
      };
    }

    const assistantMessage = raw.assistantMessage as ChatMessage;
    messages.push(assistantMessage);

    const calls = assistantMessage.tool_calls ?? [];
    if (calls.length === 0) {
      const parsed = parseWayfareAnswer(typeof assistantMessage.content === "string" ? assistantMessage.content : "");
      if (parsed.ok) {
        finalAnswer = parsed.answer;
        break;
      }
      if (iterations < maxIterations) {
        log.warn("LLM final answer failed validation, retrying", {
          provider,
          iteration: iterations,
          error: parsed.error,
          contentPreview: typeof assistantMessage.content === "string" ? assistantMessage.content.slice(0, 300) : null,
        });
        messages.push({
          role: "user",
          content: `Your previous reply did not match the required WayfareAnswer JSON schema. Error: ${parsed.error}. Respond again with ONLY a valid JSON object matching the WayfareAnswer schema.`,
        });
        continue;
      }
      log.error("LLM produced no valid answer after retries", {
        provider,
        iterations,
        error: parsed.error,
        contentPreview: typeof assistantMessage.content === "string" ? assistantMessage.content.slice(0, 300) : null,
      });
      emit({ type: "error", error: `invalid_answer: ${parsed.error}` });
      finalAnswer = { kind: "error", message: "The assistant couldn't produce a structured answer. Please try again." };
      break;
    }

    for (const call of calls) {
      const callName = call.name ?? call.function?.name ?? "";
      const rawArgs = call.arguments ?? call.function?.arguments ?? "{}";
      let parsedArgs: unknown;
      try {
        parsedArgs = JSON.parse(rawArgs);
      } catch {
        parsedArgs = rawArgs;
      }
      if (callName === "get_home_airport" && req.homeIata) {
        const obj = (parsedArgs && typeof parsedArgs === "object" ? parsedArgs : {}) as Record<string, unknown>;
        if (!obj.iata) obj.iata = req.homeIata.toUpperCase();
        parsedArgs = obj;
      }
      const tool = getToolByName(callName);
      emit({ type: "tool_progress", label: describeToolCall(callName, parsedArgs).label, tool: callName });
      let result: unknown;
      let toolError: string | undefined;
      if (!tool) {
        toolError = `unknown tool: ${callName}`;
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
      toolCalls.push({ tool: callName, arguments: parsedArgs, result });

      if (result && typeof result === "object") {
        const r = result as Record<string, unknown>;
        if (r.runId && typeof r.runId === "string") {
          emit({
            type: "run_triggered",
            toolName: callName,
            runId: r.runId,
            task: typeof r.task === "string" ? r.task : null,
            crawlRunId: typeof r.crawlRunId === "string" ? r.crawlRunId : null,
            publicAccessToken: typeof r.publicAccessToken === "string" ? r.publicAccessToken : null,
          });
        }
      }

      messages.push({
        role: "tool",
        content: typeof result === "string" ? result : JSON.stringify(result),
        tool_call_id: call.id,
        name: callName,
      });
    }
  }

  if (!finalAnswer) {
    log.warn("LLM exhausted iterations without structured answer", { provider, iterations, toolCalls: toolCalls.length });
    finalAnswer = {
      kind: "error",
      message: "The assistant couldn't complete the request in time. Please try a more specific question.",
    };
  }

  emit({ type: "answer", answer: finalAnswer });
  emit({ type: "done", iterations, toolCalls: toolCalls.length });

  return {
    ok: true,
    provider,
    model,
    answer: finalAnswer,
    toolCalls,
    iterations,
    source: "env",
  };
}

export function describeToolCall(name: string, args: unknown): { label: string; tool: string } {
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  switch (name) {
    case "select_origin_on_map":
      return { label: `Selecting ${String(a.iata || "origin")} on the map…`, tool: name };
    case "draw_destination_arrows":
      return { label: `Drawing destinations from ${String(a.origin || "")}…`, tool: name };
    case "find_fastest_routes":
      return { label: `Finding fastest route to ${String(a.destination || "")}…`, tool: name };
    case "compare_origins":
      return { label: `Comparing origins → ${String(a.destination || "")}…`, tool: name };
    case "find_cheapest_destinations":
      return { label: `Searching cheapest fares from ${String(a.origin || "your home airport")}…`, tool: name };
    case "find_cheapest_dates":
      return { label: `Checking prices by date for ${String(a.origin || "")} → ${String(a.destination || "")}…`, tool: name };
    case "find_best_round_trip":
      return { label: `Building round-trip bundles ${String(a.origin || "")} ⇄ ${String(a.destination || "")}…`, tool: name };
    case "find_best_one_way":
      return { label: `Finding one-way fares ${String(a.origin || "")} → ${String(a.destination || "")}…`, tool: name };
    case "find_weekend_deals":
      return { label: `Looking for weekend trips to ${String(a.destination || a.origin || "")}…`, tool: name };
    case "find_cheapest_from_any_origin":
      return { label: `Comparing from ${Array.isArray(a.origins) ? a.origins.join(", ") : ""}…`, tool: name };
    case "plan_round_trip":
      return { label: `Planning round trip ${String(a.origin || "")} ⇄ ${String(a.destination || "")}…`, tool: name };
    case "plan_multi_stop":
      return { label: `Planning multi-stop trip from ${String(a.homeIata || "")}…`, tool: name };
    case "trigger_refresh_crawl": {
      const legs = Array.isArray(a.legs) ? a.legs.length : 0;
      return { label: `Crawling prices for ${legs} route${legs === 1 ? "" : "s"}…`, tool: name };
    }
    case "search_airports":
      return { label: `Looking up "${String(a.query || "")}"…`, tool: name };
    case "get_home_airport":
      return { label: `Resolving your home airport…`, tool: name };
    case "save_favorite":
      return { label: "Saving favorite…", tool: name };
    case "remove_favorite":
      return { label: "Removing favorite…", tool: name };
    case "list_favorites":
      return { label: "Loading favorites…", tool: name };
    default:
      return { label: `Working (${name})…`, tool: name };
  }
}

function getToolByName(name: string): ToolDefinition | null {
  for (const t of listTools()) if (t.name === name) return t;
  return null;
}

function defaultModel(provider: string): string {
  if (provider === "openrouter") return "openai/gpt-4o-mini";
  if (provider === "minimax") return "MiniMax-M3";
  return "gpt-4o-mini";
}

interface CallArgs {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  forceJsonObject?: boolean;
}

async function callProvider(provider: string, args: CallArgs): Promise<{ assistantMessage: ChatMessage }> {
  if (provider === "openai" || provider === "openrouter" || provider === "minimax") {
    const url = provider === "openrouter"
      ? "https://openrouter.ai/api/v1/chat/completions"
      : provider === "minimax"
      ? "https://api.minimax.io/v1/chat/completions"
      : "https://api.openai.com/v1/chat/completions";
    const tools = toOpenAiTools();
    const body: Record<string, unknown> = {
      model: args.model,
      messages: args.messages,
      tools,
      tool_choice: "auto",
      stream: false,
    };
    if (args.forceJsonObject) {
      body.response_format = { type: "json_object" };
    }
    const bodyStr = JSON.stringify(body);
    log.debug(">>> LLM request", {
      provider,
      url,
      model: args.model,
      messageCount: args.messages.length,
      toolCount: tools.length,
      forceJsonObject: Boolean(args.forceJsonObject),
      bodyBytes: bodyStr.length,
      lastRole: args.messages[args.messages.length - 1]?.role,
    });
    let res: Response;
    const maxAttempts = 3;
    let attempt = 0;
    while (true) {
      attempt += 1;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${args.apiKey}`,
          },
          body: bodyStr,
        });
      } catch (err) {
        if (attempt < maxAttempts) {
          const backoffMs = 500 * attempt + Math.floor(Math.random() * 250);
          log.warn("<<< LLM transport error, retrying", {
            provider,
            url,
            model: args.model,
            attempt,
            backoffMs,
            error: (err as Error).message,
          });
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }
        log.error("<<< LLM transport error", {
          provider,
          url,
          model: args.model,
          messageCount: args.messages.length,
          error: (err as Error).message,
        });
        throw err;
      }
      if (res.ok) break;
      const transient = res.status === 429 || res.status === 500 || res.status === 502 || res.status === 503 || res.status === 504;
      if (transient && attempt < maxAttempts) {
        const errText = await res.text();
        const backoffMs = 500 * attempt + Math.floor(Math.random() * 250);
        log.warn("<<< LLM transient HTTP error, retrying", {
          provider,
          url,
          model: args.model,
          attempt,
          backoffMs,
          status: res.status,
          responseBodyPreview: errText.slice(0, 500),
        });
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }
      const errText = await res.text();
      log.error("<<< LLM HTTP error", {
        provider,
        url,
        model: args.model,
        status: res.status,
        statusText: res.statusText,
        contentType: res.headers.get("content-type"),
        messageCount: args.messages.length,
        toolCount: tools.length,
        bodyBytes: bodyStr.length,
        responseBody: errText.slice(0, 4000),
        responseBytes: errText.length,
        requestBody: body,
        requestMessages: args.messages,
      });
      throw new Error(`LLM HTTP ${res.status}: ${errText.slice(0, 2000)}`);
    }
    const rawBody = await res.text();
    const parsed = parseChatCompletionsResponse(rawBody);
    if (parsed.kind === "error") {
      log.error("<<< LLM returned error chunk", {
        provider,
        url,
        model: args.model,
        rawResponse: parsed.raw,
      });
      throw new Error(`LLM upstream error: ${parsed.message}`);
    }
    const data = parsed.data;
    const message = data.choices[0]?.message;
    if (!message) {
      log.error("<<< LLM returned no choices", {
        provider,
        url,
        model: args.model,
        rawResponse: parsed.raw.slice(0, 4000),
      });
      throw new Error("LLM returned no choices");
    }
    log.debug("<<< LLM ok", {
      provider,
      model: args.model,
      hasContent: Boolean(message.content),
      toolCallCount: Array.isArray(message.tool_calls) ? message.tool_calls.length : 0,
    });
    if (Array.isArray(message.tool_calls)) {
      message.tool_calls = message.tool_calls.map((c) => {
        const fn = (c.function as { name?: string; arguments?: string } | undefined) ?? null;
        const name = String(fn?.name ?? (c as { name?: string }).name ?? "");
        const args = String(fn?.arguments ?? (c as { arguments?: string }).arguments ?? "{}");
        return {
          id: String(c.id ?? ""),
          type: "function",
          function: { name, arguments: args },
        };
      });
    }
    return { assistantMessage: message };
  }

  throw new Error(`unsupported LLM provider: ${provider}`);
}

type ParsedChatResponse =
  | { kind: "ok"; data: { choices: Array<{ message: ChatMessage & { tool_calls?: Array<Record<string, unknown>> } }> }; raw: string }
  | { kind: "error"; message: string; raw: string };

function parseChatCompletionsResponse(rawBody: string): ParsedChatResponse {
  const trimmed = rawBody.trim();
  if (!trimmed) return { kind: "error", message: "empty response body", raw: rawBody };
  const chunks = trimmed
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => s.replace(/^data:\s*/, ""));
  let lastError: { message: string } | null = null;
  for (const chunk of chunks) {
    let obj: Record<string, unknown> | null = null;
    try {
      obj = JSON.parse(chunk) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (obj.type === "error") {
      const err = obj.error as { message?: string; type?: string } | undefined;
      lastError = { message: err?.message ?? "unknown upstream error" };
      continue;
    }
    if (Array.isArray(obj.choices)) {
      return { kind: "ok", data: obj as unknown as { choices: Array<{ message: ChatMessage & { tool_calls?: Array<Record<string, unknown>> } }> }, raw: rawBody };
    }
  }
  if (lastError) return { kind: "error", message: lastError.message, raw: rawBody };
  return { kind: "error", message: "no chat.completion object in response", raw: rawBody };
}

export { WayfareAnswerSchema, WAYFARE_ANSWER_JSON_SCHEMA, parseWayfareAnswer, type WayfareAnswer };
