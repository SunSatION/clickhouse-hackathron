import { z } from "zod";
import { defineTool } from "./registry.js";
import { tasks } from "@trigger.dev/sdk";
import { enqueuePendingRoutes } from "../../db/crawl-progress.js";
import { CRAWL_CONFIG } from "../../config/crawl.js";

function defaultDateRange(): { dateFrom: string; dateTo: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 3, 0));
  return {
    dateFrom: start.toISOString().slice(0, 10),
    dateTo: end.toISOString().slice(0, 10),
  };
}

export const ToolTriggerCrawlFromOrigin = defineTool({
  id: "tool-trigger-crawl-from-origin",
  name: "trigger_crawl_from_origin",
  description:
    "Start a fresh crawl for all routes departing from a specific airport. Use this when the user asks to refresh, update, or crawl fares from a particular airport, or when price data appears stale for a given origin. This queues all destinations from that origin and triggers the crawl queue worker.",
  schema: z.object({
    origin: z.string().length(3).describe("3-letter IATA code of the origin airport to crawl from."),
    dateFrom: z.string().optional().describe("Outbound crawl start date (YYYY-MM-DD). Defaults to the 1st of the current month."),
    dateTo: z.string().optional().describe("Outbound crawl end date (YYYY-MM-DD). Defaults to end of month + 2 months."),
    airline: z.enum(["Ryanair", "EasyJet"]).optional().describe("Airline to crawl (default Ryanair)."),
  }),
  handler: async ({ origin, dateFrom, dateTo, airline }: { origin: string; dateFrom?: string; dateTo?: string; airline?: "Ryanair" | "EasyJet" }) => {
    const a = airline ?? "Ryanair";
    const range = defaultDateRange();
    const crawlRunId = crypto.randomUUID();

    const enqueue = await enqueuePendingRoutes({
      airline: a,
      origins: [origin.toUpperCase()],
      dateFrom: dateFrom ?? range.dateFrom,
      dateTo: dateTo ?? range.dateTo,
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
      origin: origin.toUpperCase(),
      runId: handle.id,
      task: "crawl-queue-worker",
      publicAccessToken: handle.publicAccessToken,
      enqueued: enqueue.enqueued,
      alreadyPending: enqueue.already_pending,
      dateFrom: dateFrom ?? range.dateFrom,
      dateTo: dateTo ?? range.dateTo,
    };
  },
});
