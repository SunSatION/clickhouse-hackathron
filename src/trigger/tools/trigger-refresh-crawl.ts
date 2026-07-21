import { z } from "zod";
import { defineTool } from "./registry.js";
import { tasks } from "@trigger.dev/sdk";
import { enqueuePendingRoutes } from "../../db/crawl-progress.js";
import { CRAWL_CONFIG } from "../../config/crawl.js";

export const ToolRefreshCrawl = defineTool({
  id: "tool-refresh-crawl",
  name: "trigger_refresh_crawl",
  description:
    "Queue a fresh crawl for one or more flight legs that are missing price data. Runs the crawl-queue-worker.",
  schema: z.object({
    legs: z
      .array(
        z.object({
          origin: z.string().length(3),
          destination: z.string().length(3),
          dateFrom: z.string().describe("YYYY-MM-DD"),
          dateTo: z.string().describe("YYYY-MM-DD"),
        }),
      )
      .min(1)
      .max(50),
    airline: z.enum(["Ryanair", "EasyJet"]).optional(),
    runId: z.string().optional(),
  }),
  handler: async ({ legs, airline, runId }: { legs: Array<{ origin: string; destination: string; dateFrom: string; dateTo: string }>; airline?: "Ryanair" | "EasyJet"; runId?: string }) => {
    const a = airline ?? "Ryanair";
    const crawlRunId = runId ?? crypto.randomUUID();
    const origins = Array.from(new Set(legs.map((l: { origin: string }) => l.origin)));
    const first = legs[0];
    if (!first) throw new Error("legs must not be empty");
    const enqueue = await enqueuePendingRoutes({
      airline: a,
      origins,
      dateFrom: first.dateFrom,
      dateTo: first.dateTo,
      crawlRunId,
    });

    const handle = await tasks.trigger<
      typeof import("../../trigger/crawl-queue-worker.js").crawlQueueWorker
    >("crawl-queue-worker", {
      airline: a,
      crawlRunId,
      maxIterations: Math.max(enqueue.enqueued + enqueue.already_pending, 1),
      adults: CRAWL_CONFIG[a.toLowerCase() as "ryanair" | "easyjet"]?.adults ?? 1,
      requestDelayMs: CRAWL_CONFIG[a.toLowerCase() as "ryanair" | "easyjet"]?.requestDelayMs ?? 0,
      requestJitterMs: CRAWL_CONFIG[a.toLowerCase() as "ryanair" | "easyjet"]?.requestJitterMs ?? 0,
      cooldownMs: CRAWL_CONFIG[a.toLowerCase() as "ryanair" | "easyjet"]?.cooldownMs ?? 0,
    });

    return {
      ok: true,
      crawlRunId,
      airline: a,
      runId: handle.id,
      task: "crawl-queue-worker",
      publicAccessToken: handle.publicAccessToken,
      enqueued: enqueue.enqueued,
      alreadyPending: enqueue.already_pending,
      legsQueued: legs.length,
      legs,
    };
  },
});
