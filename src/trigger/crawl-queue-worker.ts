import { logger, metadata, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";

import { CRAWL_CONFIG } from "../config";
import { crawlRyanairRangeForOrigin } from "../airlines/ryanair";
import {
  configureOtel,
  incCounter,
  installFetchInstrumentation,
  otelLogger,
  traceTask,
  withSpan,
} from "../observability";
import { claimNextPendingItem, markProgressCompleted, markProgressFailed } from "../db/crawl-progress";
import { TASK_DESCRIPTIONS } from "./task-descriptions";

configureOtel({
  resource: {
    serviceName: "hackathron-crawler",
    attributes: { "app.component": "crawl-queue-worker" },
  },
});
installFetchInstrumentation();

export const CrawlQueueWorkerPayload = z.object({
  airline: z.enum(["Ryanair", "EasyJet"]),
  crawlRunId: z.string().uuid(),
  maxIterations: z.number().int().min(1).max(2000).default(1500),
  adults: z.number().int().min(1).max(9).default(CRAWL_CONFIG.ryanair.adults),
  requestDelayMs: z.number().int().min(0).default(CRAWL_CONFIG.ryanair.requestDelayMs),
  requestJitterMs: z.number().int().min(0).default(CRAWL_CONFIG.ryanair.requestJitterMs),
  cooldownMs: z.number().int().min(0).default(CRAWL_CONFIG.ryanair.cooldownMs),
});

export type CrawlQueueWorkerPayloadT = z.infer<typeof CrawlQueueWorkerPayload>;

export const crawlQueueWorker = schemaTask({
  id: "crawl-queue-worker",
  description: TASK_DESCRIPTIONS["crawl-queue-worker"].summary,
  schema: CrawlQueueWorkerPayload,
  maxDuration: 7200,
  ttl: "3h",
  queue: { concurrencyLimit: 1 },
  retry: { maxAttempts: 1 },
  run: async (payload) => {
    const trace = traceTask({
      name: "crawl-queue-worker",
      runId: payload.crawlRunId,
      attributes: { "airline": payload.airline },
    });
    trace.start();

    metadata.set("airline", payload.airline);
    metadata.set("workerRunId", payload.crawlRunId);

    logger.info("Crawl queue worker starting", {
      airline: payload.airline,
      crawlRunId: payload.crawlRunId,
      maxIterations: payload.maxIterations,
    });

    let processed = 0;
    let completed = 0;
    let failed = 0;

    for (let i = 0; i < payload.maxIterations; i++) {
      const item = await claimNextPendingItem({
        airline: payload.airline,
        crawlRunId: payload.crawlRunId,
      });

      if (!item) {
        logger.info("No more pending items, worker stopping", {
          airline: payload.airline,
          processed,
          completed,
          failed,
        });
        break;
      }

      processed++;
      metadata.set("iteration", i + 1);
      metadata.set("currentOrigin", item.origin_iata);
      metadata.set("currentDestination", item.destination_iata);

      logger.info("Claimed queue item", {
        iteration: i + 1,
        origin: item.origin_iata,
        destination: item.destination_iata,
        dateFrom: item.date_from,
        dateTo: item.date_to,
      });

      try {
        const result = await withSpan(
          "crawl.worker.item",
          async () => {
            if (payload.airline === "Ryanair") {
              return await crawlRyanairRangeForOrigin(item.origin_iata, {
                crawlRunId: item.crawl_run_id || payload.crawlRunId,
                observedAt: new Date(),
                adults: payload.adults,
                requestDelayMs: payload.requestDelayMs,
                requestJitterMs: payload.requestJitterMs,
                cooldownMs: payload.cooldownMs,
                dateFrom: String(item.date_from),
                dateTo: String(item.date_to),
                destinationFilter: [item.destination_iata],
                persist: true,
                resumeFromProgress: false,
                logger: otelLogger(),
              });
            } else {
              throw new Error(`Airline ${payload.airline} not yet implemented in queue worker`);
            }
          },
          { "airline": payload.airline, "origin": item.origin_iata }
        );

        await markProgressCompleted({
          airline: payload.airline,
          originIata: item.origin_iata,
          destinationIata: item.destination_iata,
          dateFrom: String(item.date_from),
          dateTo: String(item.date_to),
          crawlRunId: payload.crawlRunId,
          rowsInserted: result.rowsInserted,
        });

        completed++;
        incCounter("crawl.worker.completed", 1, { airline: payload.airline });

        logger.info("Queue item completed", {
          origin: item.origin_iata,
          rowsInserted: result.rowsInserted,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);

        await markProgressFailed({
          airline: payload.airline,
          originIata: item.origin_iata,
          destinationIata: item.destination_iata,
          dateFrom: String(item.date_from),
          dateTo: String(item.date_to),
          crawlRunId: payload.crawlRunId,
          error: errMsg,
        });

        failed++;
        incCounter("crawl.worker.failed", 1, { airline: payload.airline });

        logger.error("Queue item failed", {
          origin: item.origin_iata,
          destination: item.destination_iata,
          error: errMsg,
        });
      }
    }

    metadata.set("processed", processed);
    metadata.set("completed", completed);
    metadata.set("failed", failed);

    logger.info("Crawl queue worker finished", {
      airline: payload.airline,
      processed,
      completed,
      failed,
    });

    trace.finish({ processed, completed, failed });

    return {
      airline: payload.airline,
      processed,
      completed,
      failed,
    };
  },
});
