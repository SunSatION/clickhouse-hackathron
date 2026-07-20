import type { VercelRequest, VercelResponse } from "@vercel/node";
import { tasks } from "@trigger.dev/sdk";

import type { llmChatAgent } from "../../src/trigger/llm-chat-agent";

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
    const handle = await tasks.trigger<typeof llmChatAgent>("llm-chat-agent", {
      messages,
      maxIterations,
    });

    res.json({
      ok: true,
      runId: handle.id,
      publicAccessToken: handle.publicAccessToken,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
}
