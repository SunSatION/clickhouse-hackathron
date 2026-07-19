import {
  logger,
  metadata,
  schedules,
  schemaTask,
} from "@trigger.dev/sdk";

import { CRAWL_CONFIG } from "../config";
import {
  configureOtel,
  incCounter,
  installFetchInstrumentation,
  traceTask,
} from "../observability";
import { crawlRyanair } from "./crawl-ryanair";
import {
  CrawlAirlinesInput,
  CrawlAirlinesOutput,
  CrawlAirlinesPayload,
  RyanairFanOutInput,
} from "./schemas";
import { TASK_DESCRIPTIONS } from "./task-descriptions";

configureOtel({
  resource: { serviceName: "hackathron-crawler", attributes: { "app.component": "crawl-airlines" } },
});
installFetchInstrumentation();

export const crawlAirlines = schemaTask({
  id: "crawl-airlines",
  description: TASK_DESCRIPTIONS["crawl-airlines"].summary,
  schema: CrawlAirlinesPayload,
  maxDuration: 3600,
  queue: { concurrencyLimit: 1 },
  retry: {
    maxAttempts: 1,
  },
  run: async (payload) => {
    const trace = traceTask({
      name: "crawl-airlines",
      runId: payload.crawlRunId,
      attributes: {
        "airlines.requested": payload.airlines.join(","),
        "crawl.date_from": payload.dateFrom,
        "crawl.date_to": payload.dateTo,
      },
    });
    trace.start();

    metadata.set("phase", "airline-fan-out");
    metadata.set("runId", payload.crawlRunId);
    metadata.set("airlines", payload.airlines.join(","));

    logger.info("Crawl airlines starting", {
      runId: payload.crawlRunId,
      airlines: payload.airlines,
    });

    const startedAt = Date.now();

    const items: {
      airline: (typeof payload.airlines)[number];
      payload: RyanairFanOutInput;
    }[] = [];

    for (const airline of payload.airlines) {
      const origins = payload.origins[airline] ?? [];
      if (origins.length === 0) continue;
      items.push({
        airline,
        payload: {
          crawlRunId: payload.crawlRunId,
          origins,
          destinationFilter: payload.destinationFilter,
          dateFrom: payload.dateFrom,
          dateTo: payload.dateTo,
          adults: payload.adults,
          requestDelayMs: payload.requestDelayMs,
          requestJitterMs: payload.requestJitterMs,
          cooldownMs: payload.cooldownMs,
        },
      });
    }

    if (items.length === 0) {
      logger.warn("No origins configured for any airline", {
        payload,
      });
      return CrawlAirlinesOutput.parse({
        crawlRunId: payload.crawlRunId,
        rowsInserted: 0,
        durationMs: 0,
        byAirline: {},
      });
    }

    const batch = await crawlRyanair.batchTriggerAndWait(
      items.map((item) => ({ payload: item.payload }))
    );

    let rowsInserted = 0;
    let totalRequests = 0;
    let totalCacheHits = 0;
    let totalSkipped = 0;
    const byAirline: Record<
      string,
      {
        rowsInserted: number;
        errors: string[];
        requestsMade: number;
        cacheHits: number;
        requestsSkipped: number;
      }
    > = {};

    batch.runs.forEach((run, idx) => {
      const item = items[idx];
      if (!item) return;
      const airlineCode = item.airline;
      byAirline[airlineCode] ??= {
        rowsInserted: 0,
        errors: [],
        requestsMade: 0,
        cacheHits: 0,
        requestsSkipped: 0,
      };

      if (run.ok) {
        rowsInserted += run.output.rowsInserted;
        byAirline[airlineCode].rowsInserted += run.output.rowsInserted;
        totalRequests += run.output.requestsMade;
        totalCacheHits += run.output.cacheHits;
        totalSkipped += run.output.requestsSkipped;
        byAirline[airlineCode].requestsMade += run.output.requestsMade;
        byAirline[airlineCode].cacheHits += run.output.cacheHits;
        byAirline[airlineCode].requestsSkipped += run.output.requestsSkipped;
        for (const e of run.output.errors) {
          byAirline[airlineCode].errors.push(
            `${e.origin}@${e.date}: ${e.message}`
          );
        }
      } else {
        const errMsg = String(
          (run.error as { message?: string } | null)?.message ?? run.error
        );
        byAirline[airlineCode].errors.push(errMsg);
        logger.error("Airline run failed", { airline: airlineCode, error: errMsg });
      }
    });

    const durationMs = Date.now() - startedAt;
    const totalErrors = Object.values(byAirline).reduce(
      (s, a) => s + a.errors.length,
      0
    );

    metadata.set("rowsInserted", rowsInserted);
    metadata.set("errors", totalErrors);
    metadata.set("requestsMade", totalRequests);
    metadata.set("cacheHits", totalCacheHits);
    metadata.set("requestsSkipped", totalSkipped);

    logger.info("Crawl airlines finished", {
      runId: payload.crawlRunId,
      rowsInserted,
      errors: totalErrors,
      requests: totalRequests,
      cacheHits: totalCacheHits,
      requestsSkipped: totalSkipped,
      durationMs,
    });

    incCounter("crawl.airlines.rows_inserted", rowsInserted, {
      airlines: payload.airlines.join(","),
    });
    incCounter("crawl.airlines.requests_made", totalRequests, {
      airlines: payload.airlines.join(","),
    });

    trace.finish({
      rows_inserted: rowsInserted,
      requests_made: totalRequests,
      cache_hits: totalCacheHits,
      duration_ms: durationMs,
      errors: totalErrors,
      airlines_count: payload.airlines.length,
    });

    return CrawlAirlinesOutput.parse({
      crawlRunId: payload.crawlRunId,
      rowsInserted,
      durationMs,
      byAirline,
    });
  },
});

export const hourlyCrawlAirlines = schedules.task({
  id: "crawl-airlines-six-hours",
  description: TASK_DESCRIPTIONS["crawl-airlines-six-hours"].summary,
  cron: "0 */6 * * *",
  maxDuration: 1800,
  queue: { concurrencyLimit: 1 },
  run: async () => {
    const crawlRunId = crypto.randomUUID();
    const dateFromDate = new Date();
    const dateToDate = new Date();
    dateToDate.setUTCDate(dateToDate.getUTCDate() + 30);

    const dateFromIso = dateFromDate.toISOString().slice(0, 10);
    const dateToIso = dateToDate.toISOString().slice(0, 10);

    const originsRaw = process.env.RYANAIR_ORIGINS;
    const origins: string[] = originsRaw
      ? originsRaw
          .split(",")
          .map((s) => s.trim().toUpperCase())
          .filter((s) => /^[A-Z]{3}$/.test(s))
      : ["STN", "DUB", "BGY", "CRL", "BVA", "BCN", "MAD", "FCO"];

    await crawlAirlines.trigger({
      crawlRunId,
      airlines: ["FR"],
      origins: { FR: origins },
      dateFrom: dateFromIso,
      dateTo: dateToIso,
      adults: CRAWL_CONFIG.ryanair.adults,
      requestDelayMs: CRAWL_CONFIG.ryanair.requestDelayMs,
      requestJitterMs: CRAWL_CONFIG.ryanair.requestJitterMs,
      cooldownMs: CRAWL_CONFIG.ryanair.cooldownMs,
    } satisfies CrawlAirlinesInput);

    metadata.set("hourlyRunId", crawlRunId);
  },
});
