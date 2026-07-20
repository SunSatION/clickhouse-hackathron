import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { tasks } from "@trigger.dev/sdk";

const LlmChatPayload = z.object({
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
  maxIterations: z.number().int().min(1).max(10).default(6),
});

type LlmChatPayloadT = z.infer<typeof LlmChatPayload>;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const messages = Array.isArray(req.body?.messages) ? req.body.messages : null;
  if (!messages || messages.length === 0) {
    res.status(400).json({ ok: false, error: "messages[] is required" });
    return;
  }

  const maxIterations = Math.max(1, Math.min(10, Number(req.body?.maxIterations ?? 6)));

  try {
    const payload: LlmChatPayloadT = {
      messages,
      maxIterations,
    };
    const handle = await tasks.trigger<LlmChatPayloadT>("llm-chat-agent", payload);

    res.json({
      ok: true,
      runId: handle.id,
      publicAccessToken: handle.publicAccessToken,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
}
