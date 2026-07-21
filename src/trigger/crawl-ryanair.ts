import { logger, metadata, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";

import { crawlRyanairForOrigin } from "../airlines/ryanair.js";
import {
  isSupportedAirline,
  stagingTableFor,
} from "../db/flight-listings.js";
import { runMigrations } from "../db/migrate.js";
import {
  configureOtel,
  installFetchInstrumentation,
  incCounter,
  otelLogger,
  traceTask,
  withSpan,
} from "../observability";
import {
  RyanairFanOutOutput,
  RyanairFanOutPayload,
  RyanairRouteOutput,
  RyanairRoutePayload,
} from "./schemas.js";
import { TASK_DESCRIPTIONS } from "./task-descriptions.js";

configureOtel({
  resource: { serviceName: "hackathron-crawler", attributes: { "app.component": "crawl-ryanair" } },
});
installFetchInstrumentation();

export const crawlRyanairRoute = schemaTask({
  id: "crawl-ryanair-route",
  description: TASK_DESCRIPTIONS["crawl-ryanair-route"].summary,
  schema: RyanairRoutePayload,
  maxDuration: 900,
  queue: { concurrencyLimit: 1 },
  retry: {
    maxAttempts: 2,
    minTimeoutInMs: 5_000,
    maxTimeoutInMs: 30_000,
    factor: 2,
  },
  run: async (payload) => {
    const trace = traceTask({
      name: "crawl-ryanair-route",
      runId: payload.crawlRunId,
      attributes: {
        "airline.code": "FR",
        "airline.name": "Ryanair",
        "origin.iata": payload.originIata,
        "crawl.date_from": payload.dateFrom,
        "crawl.date_to": payload.dateTo,
      },
    });
    trace.start();

    metadata.set("airline", "Ryanair");
    metadata.set("origin", payload.originIata);
    metadata.set("dateFrom", payload.dateFrom);
    metadata.set("dateTo", payload.dateTo);
    metadata.set("runId", payload.crawlRunId);
    metadata.set("stagingTable", stagingTableFor("Ryanair") ?? "(unknown)");

    logger.info("Ryanair route crawl starting", {
      origin: payload.originIata,
      dateFrom: payload.dateFrom,
      dateTo: payload.dateTo,
      runId: payload.crawlRunId,
    });

    const migration = await runMigrations();
    if (migration.applied.length > 0) {
      logger.info("Applied ClickHouse migrations", {
        applied: migration.applied,
      });
      metadata.set("migrationsApplied", migration.applied);
    }

    const startedAt = Date.now();
    const observedAt = new Date();

    try {
      const result = await withSpan(
        "crawl.ryanair.route",
        () =>
          crawlRyanairForOrigin(payload.originIata, payload.dateFrom, payload.dateTo, {
            crawlRunId: payload.crawlRunId,
            observedAt,
            adults: payload.adults,
            destinationFilter: payload.destinationFilter,
            requestDelayMs: payload.requestDelayMs,
            requestJitterMs: payload.requestJitterMs,
            airline: "Ryanair",
            logger: otelLogger(),
          }),
        {
          "airline.code": "FR",
          "origin.iata": payload.originIata,
        }
      );

      if (!isSupportedAirline("Ryanair")) {
        throw new Error("Ryanair staging table not registered");
      }

      const inserted = result.rowsInserted;
      const durationMs = Date.now() - startedAt;

      metadata.set("rowsInserted", inserted);
      metadata.set("errors", result.errors.length);
      metadata.set("requestsMade", result.requestsMade);
      metadata.set("cacheHits", result.cacheHits);
      metadata.set("requestsSkipped", result.requestsSkipped);

      logger.info("Ryanair route crawl finished", {
        origin: payload.originIata,
        dateFrom: payload.dateFrom,
        dateTo: payload.dateTo,
        rows: inserted,
        destinations: result.destinationsScanned.size,
        requestsMade: result.requestsMade,
        cacheHits: result.cacheHits,
        requestsSkipped: result.requestsSkipped,
        errors: result.errors.length,
        durationMs,
      });

      incCounter("crawl.rows_inserted", inserted, { "airline.code": "FR" });
      incCounter("crawl.requests_made", result.requestsMade, { "airline.code": "FR" });
      incCounter("crawl.cache_hits", result.cacheHits, { "airline.code": "FR" });

      trace.finish({
        rows_inserted: inserted,
        requests_made: result.requestsMade,
        cache_hits: result.cacheHits,
        duration_ms: durationMs,
        errors: result.errors.length,
      });

      return RyanairRouteOutput.parse({
        originIata: payload.originIata,
        dateFrom: payload.dateFrom,
        dateTo: payload.dateTo,
        destinationsScanned: result.destinationsScanned.size,
        rowsInserted: inserted,
        requestsMade: result.requestsMade,
        cacheHits: result.cacheHits,
        requestsSkipped: result.requestsSkipped,
        errors: result.errors,
        durationMs,
      });
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      trace.fail(err, {
        duration_ms: durationMs,
        origin_iata: payload.originIata,
      });
      throw err;
    }
  },
});

export const crawlRyanair = schemaTask({
  id: "crawl-ryanair",
  description: TASK_DESCRIPTIONS["crawl-ryanair"].summary,
  schema: RyanairFanOutPayload,
  maxDuration: 1800,
  queue: { concurrencyLimit: 1 },
  retry: {
    maxAttempts: 1,
  },
  run: async (payload) => {
    const trace = traceTask({
      name: "crawl-ryanair",
      runId: payload.crawlRunId,
      attributes: {
        "airline.code": "FR",
        "airline.name": "Ryanair",
        "crawl.date_from": payload.dateFrom,
        "crawl.date_to": payload.dateTo,
        "crawl.origins": payload.origins.join(","),
      },
    });
    trace.start();

    metadata.set("airline", "Ryanair");
    metadata.set("phase", "fan-out");
    metadata.set("runId", payload.crawlRunId);

    logger.info("Ryanair fan-out starting", {
      origins: payload.origins.length,
      dateFrom: payload.dateFrom,
      dateTo: payload.dateTo,
      cooldownMs: payload.cooldownMs,
      runId: payload.crawlRunId,
    });

    const startedAt = Date.now();

    const batchItems = payload.origins.map((origin) => ({
      payload: {
        crawlRunId: payload.crawlRunId,
        originIata: origin,
        dateFrom: payload.dateFrom,
        dateTo: payload.dateTo,
        destinationFilter: payload.destinationFilter,
        adults: payload.adults,
        requestDelayMs: payload.requestDelayMs,
        requestJitterMs: payload.requestJitterMs,
        cooldownMs: payload.cooldownMs,
      },
    }));

    try {
      const batch = await crawlRyanairRoute.batchTriggerAndWait(batchItems);

      let rowsInserted = 0;
      let totalRequestsMade = 0;
      let totalCacheHits = 0;
      let totalRequestsSkipped = 0;
      const errors: z.infer<typeof RyanairFanOutOutput>["errors"] = [];

      for (const run of batch.runs) {
        if (run.ok) {
          rowsInserted += run.output.rowsInserted;
          totalRequestsMade += run.output.requestsMade;
          totalCacheHits += run.output.cacheHits;
          totalRequestsSkipped += run.output.requestsSkipped;
          for (const e of run.output.errors) errors.push(e);
        } else {
          const errMsg = String(
            (run.error as { message?: string } | null)?.message ?? run.error
          );
          logger.error("Ryanair route run failed", {
            id: run.id,
            error: errMsg,
          });
          errors.push({
            origin: "(unknown)",
            date: "*",
            message: errMsg,
          });
        }
      }

      const durationMs = Date.now() - startedAt;

      metadata.set("rowsInserted", rowsInserted);
      metadata.set("errors", errors.length);
      metadata.set("requestsMade", totalRequestsMade);
      metadata.set("cacheHits", totalCacheHits);
      metadata.set("requestsSkipped", totalRequestsSkipped);

      logger.info("Ryanair fan-out finished", {
        origins: payload.origins.length,
        rows: rowsInserted,
        errors: errors.length,
        durationMs,
      });

      incCounter("crawl.fanout.rows_inserted", rowsInserted, { "airline.code": "FR" });
      incCounter("crawl.fanout.requests_made", totalRequestsMade, { "airline.code": "FR" });

      trace.finish({
        rows_inserted: rowsInserted,
        requests_made: totalRequestsMade,
        cache_hits: totalCacheHits,
        duration_ms: durationMs,
        origins_scanned: payload.origins.length,
        errors: errors.length,
      });

      return RyanairFanOutOutput.parse({
        crawlRunId: payload.crawlRunId,
        originsScanned: payload.origins.length,
        rowsInserted,
        requestsMade: totalRequestsMade,
        cacheHits: totalCacheHits,
        requestsSkipped: totalRequestsSkipped,
        errors,
        durationMs,
      });
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      trace.fail(err, {
        duration_ms: durationMs,
        origins_scanned: payload.origins.length,
      });
      throw err;
    }
  },
});
