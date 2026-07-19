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
import {
  claimSpecificPendingItem,
  getCurrentRowState,
  markProgressCompleted,
  markProgressFailed,
} from "../db/crawl-progress";
import { TASK_DESCRIPTIONS } from "./task-descriptions";

configureOtel({
  resource: {
    serviceName: "hackathron-crawler",
    attributes: { "app.component": "crawl-pending-item" },
  },
});
installFetchInstrumentation();

export const CrawlPendingItemPayload = z.object({
  airline: z.enum(["Ryanair", "EasyJet"]),
  crawlRunId: z.string().uuid(),
  originIata: z.string().length(3).regex(/^[A-Z]{3}$/),
  destinationIata: z.string().length(3).regex(/^[A-Z]{3}$/),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  force: z.boolean().default(false),
  adults: z.number().int().min(1).max(9).default(CRAWL_CONFIG.ryanair.adults),
  requestDelayMs: z.number().int().min(0).default(CRAWL_CONFIG.ryanair.requestDelayMs),
  requestJitterMs: z.number().int().min(0).default(CRAWL_CONFIG.ryanair.requestJitterMs),
  cooldownMs: z.number().int().min(0).default(CRAWL_CONFIG.ryanair.cooldownMs),
});

export type CrawlPendingItemPayloadT = z.infer<typeof CrawlPendingItemPayload>;

export const crawlPendingItem = schemaTask({
  id: "crawl-pending-item",
  description: TASK_DESCRIPTIONS["crawl-pending-item"].summary,
  schema: CrawlPendingItemPayload,
  maxDuration: 3600,
  queue: { concurrencyLimit: 1 },
  retry: { maxAttempts: 1 },
  run: async (payload) => {
    const trace = traceTask({
      name: "crawl-pending-item",
      runId: payload.crawlRunId,
      attributes: {
        airline: payload.airline,
        origin: payload.originIata,
        destination: payload.destinationIata,
      },
    });
    trace.start();

    metadata.set("airline", payload.airline);
    metadata.set("origin", payload.originIata);
    metadata.set("destination", payload.destinationIata);
    metadata.set("dateFrom", payload.dateFrom);
    metadata.set("dateTo", payload.dateTo);
    metadata.set("workerRunId", payload.crawlRunId);
    metadata.set("force", payload.force);

    logger.info("Crawl pending item starting", {
      airline: payload.airline,
      origin: payload.originIata,
      destination: payload.destinationIata,
      dateFrom: payload.dateFrom,
      dateTo: payload.dateTo,
      force: payload.force,
      crawlRunId: payload.crawlRunId,
    });

    const claimed = await claimSpecificPendingItem({
      airline: payload.airline,
      originIata: payload.originIata,
      destinationIata: payload.destinationIata,
      dateFrom: payload.dateFrom,
      dateTo: payload.dateTo,
      crawlRunId: payload.crawlRunId,
      force: payload.force,
    });

    if (!claimed) {
      let diagnostics = "";
      try {
        const rows = await getCurrentRowState({
          airline: payload.airline,
          originIata: payload.originIata,
          destinationIata: payload.destinationIata,
          dateFrom: payload.dateFrom,
          dateTo: payload.dateTo,
        });
        if (rows.length === 0) {
          diagnostics = "No crawl_progress row exists for this key at all — was it ever seeded?";
        } else {
          const byStatus = new Map<string, number>();
          for (const r of rows) {
            byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
          }
          const statusBreakdown = Array.from(byStatus.entries())
            .map(([s, n]) => `${s}=${n}`)
            .join(", ");
          const sample = rows[0]!;
          const lastRun = sample.crawl_run_id ? ` last run=${sample.crawl_run_id}` : "";
          const lastError =
            sample.status === "failed" && sample.error_message
              ? ` last error="${String(sample.error_message).slice(0, 200)}"`
              : "";
          const lastInserted = sample.inserted_at ? ` last_write=${sample.inserted_at}` : "";
          diagnostics =
            `Existing row state: ${statusBreakdown}.${lastRun}${lastInserted}${lastError}`;
        }
      } catch (diagErr) {
        diagnostics = `diagnostic lookup failed: ${(diagErr as Error).message}`;
      }

      const msg =
        `No claimable crawl_progress row for ${payload.airline} ` +
        `${payload.originIata}→${payload.destinationIata} ${payload.dateFrom}..${payload.dateTo}` +
        (payload.force ? " (force=true)" : "") +
        `. ${diagnostics}`;
      logger.warn("Pending item not claimable", {
        origin: payload.originIata,
        destination: payload.destinationIata,
        dateFrom: payload.dateFrom,
        dateTo: payload.dateTo,
        force: payload.force,
        diagnostics,
      });
      trace.finish({ claimed: false, rows_inserted: 0 });
      throw new Error(msg);
    }

    if (payload.force) {
      logger.warn("Force-claimed row", {
        origin: claimed.origin_iata,
        destination: claimed.destination_iata,
        previousRunId: claimed.crawl_run_id,
      });
    }

    try {
      const result = await withSpan(
        "crawl.pending.item",
        async () => {
          if (payload.airline !== "Ryanair") {
            throw new Error(`Airline ${payload.airline} not yet implemented for single-item runs`);
          }
          return await crawlRyanairRangeForOrigin(claimed.origin_iata, {
            crawlRunId: payload.crawlRunId,
            observedAt: new Date(),
            adults: payload.adults,
            requestDelayMs: payload.requestDelayMs,
            requestJitterMs: payload.requestJitterMs,
            cooldownMs: payload.cooldownMs,
            dateFrom: String(claimed.date_from),
            dateTo: String(claimed.date_to),
            destinationFilter: [claimed.destination_iata],
            persist: true,
            resumeFromProgress: false,
            logger: otelLogger(),
          });
        },
        {
          airline: payload.airline,
          origin: claimed.origin_iata,
          destination: claimed.destination_iata,
        }
      );

      await markProgressCompleted({
        airline: payload.airline,
        originIata: claimed.origin_iata,
        destinationIata: claimed.destination_iata,
        dateFrom: String(claimed.date_from),
        dateTo: String(claimed.date_to),
        crawlRunId: payload.crawlRunId,
        rowsInserted: result.rowsInserted,
      });

      incCounter("crawl.pending_item.completed", 1, { airline: payload.airline });

      metadata.set("rowsInserted", result.rowsInserted);
      metadata.set("requestsMade", result.requestsMade);
      metadata.set("status", "completed");

      logger.info("Pending item completed", {
        origin: claimed.origin_iata,
        destination: claimed.destination_iata,
        rowsInserted: result.rowsInserted,
        requestsMade: result.requestsMade,
      });

      trace.finish({
        claimed: true,
        rows_inserted: result.rowsInserted,
        requests_made: result.requestsMade,
      });

      return {
        airline: payload.airline,
        origin: claimed.origin_iata,
        destination: claimed.destination_iata,
        dateFrom: String(claimed.date_from),
        dateTo: String(claimed.date_to),
        rowsInserted: result.rowsInserted,
        requestsMade: result.requestsMade,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);

      await markProgressFailed({
        airline: payload.airline,
        originIata: claimed.origin_iata,
        destinationIata: claimed.destination_iata,
        dateFrom: String(claimed.date_from),
        dateTo: String(claimed.date_to),
        crawlRunId: payload.crawlRunId,
        error: errMsg,
      });

      incCounter("crawl.pending_item.failed", 1, { airline: payload.airline });

      metadata.set("status", "failed");
      metadata.set("error", errMsg.slice(0, 200));

      logger.error("Pending item failed", {
        origin: claimed.origin_iata,
        destination: claimed.destination_iata,
        error: errMsg,
      });

      trace.fail(err, {
        rows_inserted: 0,
      });
      throw err;
    }
  },
});
