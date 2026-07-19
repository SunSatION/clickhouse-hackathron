import { logger, metadata, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";

import { CRAWL_CONFIG } from "../config";
import {
  configureOtel,
  emitGauge,
  installFetchInstrumentation,
  traceTask,
} from "../observability";
import { enqueuePendingRoutes } from "../db/crawl-progress";
import { TASK_DESCRIPTIONS } from "./task-descriptions";

configureOtel({
  resource: {
    serviceName: "hackathron-crawler",
    attributes: { "app.component": "seed-crawl-queue" },
  },
});
installFetchInstrumentation();

export const SeedCrawlQueuePayload = z.object({
  airline: z.enum(["Ryanair", "EasyJet"]),
  origins: z.array(z.string().length(3)).min(1),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type SeedCrawlQueuePayloadT = z.infer<typeof SeedCrawlQueuePayload>;

export const seedCrawlQueue = schemaTask({
  id: "seed-crawl-queue",
  description: TASK_DESCRIPTIONS["seed-crawl-queue"].summary,
  schema: SeedCrawlQueuePayload,
  maxDuration: 3600,
  queue: { concurrencyLimit: 1 },
  retry: { maxAttempts: 1 },
  run: async (payload) => {
    const trace = traceTask({
      name: "seed-crawl-queue",
      runId: crypto.randomUUID(),
      attributes: {
        "airline": payload.airline,
        "origins.count": String(payload.origins.length),
      },
    });
    trace.start();

    logger.info("Seeding crawl queue", {
      airline: payload.airline,
      origins: payload.origins,
      dateFrom: payload.dateFrom,
      dateTo: payload.dateTo,
    });

    const result = await enqueuePendingRoutes({
      airline: payload.airline,
      origins: payload.origins,
      dateFrom: payload.dateFrom,
      dateTo: payload.dateTo,
    });

    emitGauge({
      name: "crawl.queue.enqueued",
      value: result.enqueued,
      attributes: { airline: payload.airline },
    });

    metadata.set("airline", payload.airline);
    metadata.set("origins", payload.origins.join(","));
    metadata.set("enqueued", result.enqueued);

    logger.info("Crawl queue seeded", {
      airline: payload.airline,
      enqueued: result.enqueued,
    });

    trace.finish({
      enqueued: result.enqueued,
    });

    return {
      airline: payload.airline,
      enqueued: result.enqueued,
    };
  },
});
