import type { VercelRequest, VercelResponse } from "@vercel/node";

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{ id: string; name: string; arguments: string }>;
  tool_call_id?: string;
  name?: string;
}

interface LlmStreamEvent {
  type: "status" | "assistant_delta" | "tool_call" | "tool_result" | "done" | "error";
  [key: string]: unknown;
}

const SYSTEM_PROMPT = `You are Wayfare, a travel-planning assistant for the Hackathron trip planner.
You help users plan flights between European airports. Be concise — 2-6 short paragraphs max.`;

function toOpenAiTools() {
  return [
    {
      type: "function" as const,
      function: {
        name: "search_airports",
        description: "Search airports by name, city, country, or IATA code",
        parameters: {
          type: "object",
          properties: {
            q: { type: "string", description: "Search query" },
            limit: { type: "number", description: "Max results (default 10)" },
          },
          required: ["q"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "get_round_trip",
        description: "Get round-trip pricing between two airports",
        parameters: {
          type: "object",
          properties: {
            origin: { type: "string", description: "Origin IATA code" },
            destination: { type: "string", description: "Destination IATA code" },
            dateFrom: { type: "string", description: "Start date YYYY-MM-DD" },
            dateTo: { type: "string", description: "End date YYYY-MM-DD" },
          },
          required: ["origin", "destination", "dateFrom", "dateTo"],
        },
      },
    },
  ];
}

function emit(res: VercelResponse, event: LlmStreamEvent) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function callOpenAI(apiKey: string, model: string, messages: ChatMessage[]): Promise<ChatMessage> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, tools: toOpenAiTools(), tool_choice: "auto" }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 500)}`);
  const data = (await res.json()) as { choices: Array<{ message: ChatMessage }> };
  return data.choices[0]?.message ?? { role: "assistant", content: null };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "OPENAI_API_KEY not configured on the server" });
    return;
  }

  const { messages = [], maxIterations = 6 } = req.body as {
    messages: ChatMessage[];
    maxIterations?: number;
  };

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const systemMessages: ChatMessage[] = [{ role: "system", content: SYSTEM_PROMPT }];
  const conversationMessages: ChatMessage[] = [...messages];

  let iterations = 0;
  const max = Math.max(1, Math.min(10, maxIterations));

  try {
    while (iterations < max) {
      iterations++;
      emit(res, { type: "status", status: "thinking", provider: "openai", model });

      const assistantMessage = await callOpenAI(apiKey, model, [...systemMessages, ...conversationMessages]);
      conversationMessages.push(assistantMessage);

      if (typeof assistantMessage.content === "string" && assistantMessage.content) {
        emit(res, { type: "assistant_delta", content: assistantMessage.content });
      }

      const toolCalls = assistantMessage.tool_calls ?? [];
      if (toolCalls.length === 0) break;

      for (const call of toolCalls) {
        let parsedArgs: Record<string, unknown> = {};
        try { parsedArgs = JSON.parse(call.arguments); } catch { /* use raw */ }

        emit(res, { type: "tool_call", id: call.id, name: call.name, arguments: parsedArgs });

        const result = { ok: false, error: `Tool '${call.name}' is not available in the serverless environment. Deploy the full Express backend for tool access.` };

        emit(res, { type: "tool_result", id: call.id, name: call.name, result });
        conversationMessages.push({
          role: "tool",
          content: JSON.stringify(result),
          tool_call_id: call.id,
          name: call.name,
        });
      }
    }
  } catch (err) {
    emit(res, { type: "error", error: String(err) });
  }

  emit(res, { type: "done", iterations, toolCalls: 0 });
  res.end();
}
