import { logger, metadata, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";

import { crawlEasyJetForOrigin } from "../airlines/easyjet.js";
import {
  insertEasyjetListings,
  isSupportedAirline,
  stagingTableFor,
} from "../db/flight-listings.js";
import { runMigrations } from "../db/migrate.js";
import {
  configureOtel,
  incCounter,
  installFetchInstrumentation,
  otelLogger,
  traceTask,
  withSpan,
} from "../observability";
import {
  EasyJetFanOutOutput,
  EasyJetFanOutPayload,
  EasyJetRouteOutput,
  EasyJetRoutePayload,
} from "./schemas.js";
import { TASK_DESCRIPTIONS } from "./task-descriptions.js";

configureOtel({
  resource: { serviceName: "hackathron-crawler", attributes: { "app.component": "crawl-easyjet" } },
});
installFetchInstrumentation();

export const crawlEasyJetRoute = schemaTask({
  id: "crawl-easyjet-route",
  description: TASK_DESCRIPTIONS["crawl-easyjet-route"].summary,
  schema: EasyJetRoutePayload,
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
      name: "crawl-easyjet-route",
      runId: payload.crawlRunId,
      attributes: {
        "airline.code": "U2",
        "airline.name": "EasyJet",
        "origin.iata": payload.originIata,
        "crawl.date_from": payload.dateFrom,
        "crawl.date_to": payload.dateTo,
        "destinations.count": String(payload.destinations.length),
      },
    });
    trace.start();

    metadata.set("airline", "EasyJet");
    metadata.set("origin", payload.originIata);
    metadata.set("destinations", payload.destinations.length);
    metadata.set("runId", payload.crawlRunId);
    metadata.set("stagingTable", stagingTableFor("EasyJet") ?? "(unknown)");

    logger.info("EasyJet route crawl starting", {
      origin: payload.originIata,
      destinations: payload.destinations.length,
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
        "crawl.easyjet.route",
        () =>
          crawlEasyJetForOrigin(payload.originIata, payload.destinations, {
            crawlRunId: payload.crawlRunId,
            observedAt,
            dateFrom: payload.dateFrom,
            dateTo: payload.dateTo,
            currency: payload.currency,
            requestDelayMs: payload.requestDelayMs,
            requestJitterMs: payload.requestJitterMs,
            cooldownMs: payload.cooldownMs,
          }),
        {
          "airline.code": "U2",
          "origin.iata": payload.originIata,
        }
      );

      if (!isSupportedAirline("EasyJet")) {
        throw new Error("EasyJet staging table not registered");
      }

      const inserted = await insertEasyjetListings(
        result.rows,
        payload.crawlRunId
      );

      const durationMs = Date.now() - startedAt;

      metadata.set("rowsInserted", inserted);
      metadata.set("errors", result.errors.length);
      metadata.set("requestsMade", result.requestsMade);
      metadata.set("cacheHits", result.cacheHits);
      metadata.set("requestsSkipped", result.requestsSkipped);

      logger.info("EasyJet route crawl finished", {
        origin: payload.originIata,
        rows: inserted,
        destinations: result.destinationsScanned.size,
        requestsMade: result.requestsMade,
        cacheHits: result.cacheHits,
        requestsSkipped: result.requestsSkipped,
        errors: result.errors.length,
        durationMs,
      });

      incCounter("crawl.rows_inserted", inserted, { "airline.code": "U2" });
      incCounter("crawl.requests_made", result.requestsMade, { "airline.code": "U2" });

      trace.finish({
        rows_inserted: inserted,
        requests_made: result.requestsMade,
        cache_hits: result.cacheHits,
        duration_ms: durationMs,
        errors: result.errors.length,
      });

      return EasyJetRouteOutput.parse({
        originIata: payload.originIata,
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
      trace.fail(err, { duration_ms: durationMs });
      throw err;
    }
  },
});

export const crawlEasyJet = schemaTask({
  id: "crawl-easyjet",
  description: TASK_DESCRIPTIONS["crawl-easyjet"].summary,
  schema: EasyJetFanOutPayload,
  maxDuration: 1800,
  queue: { concurrencyLimit: 1 },
  retry: {
    maxAttempts: 1,
  },
  run: async (payload) => {
    const trace = traceTask({
      name: "crawl-easyjet",
      runId: payload.crawlRunId,
      attributes: {
        "airline.code": "U2",
        "airline.name": "EasyJet",
        "crawl.date_from": payload.dateFrom,
        "crawl.date_to": payload.dateTo,
        "crawl.origins": payload.origins.join(","),
      },
    });
    trace.start();

    metadata.set("airline", "EasyJet");
    metadata.set("phase", "fan-out");
    metadata.set("runId", payload.crawlRunId);

    logger.info("EasyJet fan-out starting", {
      origins: payload.origins.length,
      dateFrom: payload.dateFrom,
      dateTo: payload.dateTo,
      cooldownMs: payload.cooldownMs,
      runId: payload.crawlRunId,
    });

    const startedAt = Date.now();

    const allDestinations =
      payload.destinationFilter ?? [];

    const batchItems = payload.origins.map((origin) => ({
      payload: {
        crawlRunId: payload.crawlRunId,
        originIata: origin,
        destinations: allDestinations,
        dateFrom: payload.dateFrom,
        dateTo: payload.dateTo,
        currency: payload.currency,
        adults: payload.adults,
        requestDelayMs: payload.requestDelayMs,
        requestJitterMs: payload.requestJitterMs,
        cooldownMs: payload.cooldownMs,
      },
    }));

    try {
      const batch = await crawlEasyJetRoute.batchTriggerAndWait(batchItems);

      let rowsInserted = 0;
      let totalRequestsMade = 0;
      let totalCacheHits = 0;
      let totalRequestsSkipped = 0;
      const errors: z.infer<typeof EasyJetFanOutOutput>["errors"] = [];

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
          logger.error("EasyJet route run failed", {
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

      logger.info("EasyJet fan-out finished", {
        origins: payload.origins.length,
        rows: rowsInserted,
        errors: errors.length,
        durationMs,
      });

      incCounter("crawl.fanout.rows_inserted", rowsInserted, { "airline.code": "U2" });

      trace.finish({
        rows_inserted: rowsInserted,
        requests_made: totalRequestsMade,
        cache_hits: totalCacheHits,
        duration_ms: durationMs,
        origins_scanned: payload.origins.length,
        errors: errors.length,
      });

      return EasyJetFanOutOutput.parse({
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
      trace.fail(err, { duration_ms: durationMs });
      throw err;
    }
  },
});
