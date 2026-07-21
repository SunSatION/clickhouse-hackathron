import { logger, metadata, schemaTask } from "@trigger.dev/sdk";

import { crawlRyanairRangeForOrigin } from "../airlines/ryanair.js";
import {
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
  RyanairRangeFanOutOutput,
  RyanairRangeFanOutPayload,
  RyanairRangeRouteOutput,
  RyanairRangeRoutePayload,
} from "./schemas.js";
import { TASK_DESCRIPTIONS } from "./task-descriptions.js";

configureOtel({
  resource: { serviceName: "hackathron-crawler", attributes: { "app.component": "crawl-ryanair-range" } },
});
installFetchInstrumentation();

function toMeta(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  return { value: String(value) };
}

export const crawlRyanairRangeRoute = schemaTask({
  id: "crawl-ryanair-range-route",
  description: TASK_DESCRIPTIONS["crawl-ryanair-range-route"].summary,
  schema: RyanairRangeRoutePayload,
  maxDuration: 3600,
  ttl: "3h",
  queue: { concurrencyLimit: 1 },
  retry: {
    maxAttempts: 1,
  },
  run: async (payload) => {
    const trace = traceTask({
      name: "crawl-ryanair-range-route",
      runId: payload.crawlRunId,
      attributes: {
        "airline.code": "FR",
        "airline.name": "Ryanair",
        "origin.iata": payload.originIata,
        "crawl.date_from": payload.dateFrom,
        "crawl.date_to": payload.dateTo,
        "crawl.mode": "range",
      },
    });
    trace.start();

    metadata.set("airline", "Ryanair");
    metadata.set("origin", payload.originIata);
    metadata.set("phase", "range-route");
    metadata.set("dateFrom", payload.dateFrom);
    metadata.set("dateTo", payload.dateTo);
    metadata.set("destinationsFilterSize", payload.destinationFilter?.length ?? 0);
    metadata.set("runId", payload.crawlRunId);
    metadata.set("stagingTable", stagingTableFor("Ryanair") ?? "(unknown)");

    logger.info("Ryanair range route crawl starting", {
      origin: payload.originIata,
      dateFrom: payload.dateFrom,
      dateTo: payload.dateTo,
      destinationFilterSize: payload.destinationFilter?.length ?? 0,
      runId: payload.crawlRunId,
    });

    const migration = await runMigrations();
    if (migration.applied.length > 0) {
      logger.info("Applied ClickHouse migrations", { applied: migration.applied });
      metadata.set("migrationsApplied", migration.applied);
    }

    if (!isSupportedAirline("Ryanair")) {
      throw new Error("Ryanair staging table not registered");
    }

    const startedAt = Date.now();
    const observedAt = new Date();

    try {
      const result = await withSpan(
        "crawl.ryanair.range",
        () =>
          crawlRyanairRangeForOrigin(payload.originIata, {
            crawlRunId: payload.crawlRunId,
            observedAt,
            adults: payload.adults,
            dateFrom: payload.dateFrom,
            dateTo: payload.dateTo,
            destinationFilter: payload.destinationFilter,
            requestDelayMs: payload.requestDelayMs,
            requestJitterMs: payload.requestJitterMs,
            cooldownMs: payload.cooldownMs,
            persist: true,
            logger: otelLogger(),
          }),
        {
          "airline.code": "FR",
          "origin.iata": payload.originIata,
        }
      );

      const inserted = result.rowsInserted;
      const durationMs = Date.now() - startedAt;

      metadata.set("destinations", result.destinations.length);
      metadata.set("requestsMade", result.requestsMade);
      metadata.set("rowsInserted", inserted);
      metadata.set("flexDaysBefore", result.flexDaysBefore);
      metadata.set("flexDaysAfter", result.flexDaysAfter);
      metadata.set("durationMs", durationMs);

      logger.info("Ryanair range route crawl finished", {
        origin: payload.originIata,
        dateFrom: result.dateFrom,
        dateTo: result.dateTo,
        destinations: result.destinations.length,
        requestsMade: result.requestsMade,
        rowsInserted: inserted,
        durationMs,
        runId: payload.crawlRunId,
      });

      incCounter("crawl.range.rows_inserted", inserted, { "airline.code": "FR" });
      incCounter("crawl.range.requests_made", result.requestsMade, { "airline.code": "FR" });

      trace.finish({
        rows_inserted: inserted,
        requests_made: result.requestsMade,
        destinations: result.destinations.length,
        duration_ms: durationMs,
        errors: result.errors.length,
      });

      return RyanairRangeRouteOutput.parse({
        originIata: payload.originIata,
        dateFrom: result.dateFrom,
        dateTo: result.dateTo,
        flexDaysBefore: result.flexDaysBefore,
        flexDaysAfter: result.flexDaysAfter,
        destinations: result.destinations,
        requestsMade: result.requestsMade,
        rowsInserted: inserted,
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

export const crawlRyanairRange = schemaTask({
  id: "crawl-ryanair-range",
  description: TASK_DESCRIPTIONS["crawl-ryanair-range"].summary,
  schema: RyanairRangeFanOutPayload,
  maxDuration: 7200,
  ttl: "4h",
  queue: { concurrencyLimit: 1 },
  retry: {
    maxAttempts: 1,
  },
  run: async (payload) => {
    const trace = traceTask({
      name: "crawl-ryanair-range",
      runId: payload.crawlRunId,
      attributes: {
        "airline.code": "FR",
        "airline.name": "Ryanair",
        "crawl.date_from": payload.dateFrom,
        "crawl.date_to": payload.dateTo,
        "crawl.origins": payload.origins.join(","),
        "crawl.mode": "range",
      },
    });
    trace.start();

    metadata.set("airline", "Ryanair");
    metadata.set("phase", "range-fan-out");
    metadata.set("origins", payload.origins.join(","));
    metadata.set("dateFrom", payload.dateFrom);
    metadata.set("dateTo", payload.dateTo);
    metadata.set("destinationsFilterSize", payload.destinationFilter?.length ?? 0);
    metadata.set("runId", payload.crawlRunId);

    logger.info("Ryanair range fan-out starting", {
      origins: payload.origins,
      dateFrom: payload.dateFrom,
      dateTo: payload.dateTo,
      destinationFilterSize: payload.destinationFilter?.length ?? 0,
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
      const batch = await crawlRyanairRangeRoute.batchTriggerAndWait(batchItems);

      let rowsInserted = 0;
      let totalRequests = 0;
      const failedOrigins: { origin: string; error: string }[] = [];

      for (let i = 0; i < batch.runs.length; i += 1) {
        const run = batch.runs[i];
        if (!run) continue;
        if (run.ok) {
          rowsInserted += run.output.rowsInserted;
          totalRequests += run.output.requestsMade;
        } else {
          const errMsg = String(
            (run.error as { message?: string } | null)?.message ?? run.error
          );
          const origin =
            batchItems[i]?.payload.originIata ?? "(unknown)";
          logger.error("Ryanair range route run failed", {
            origin,
            error: errMsg,
          });
          failedOrigins.push({ origin, error: errMsg });
        }
      }

      const durationMs = Date.now() - startedAt;

      metadata.set("rowsInserted", rowsInserted);
      metadata.set("totalRequests", totalRequests);
      metadata.set("failedOrigins", failedOrigins.length);
      metadata.set("durationMs", durationMs);

      logger.info("Ryanair range fan-out finished", {
        origins: payload.origins,
        dateFrom: payload.dateFrom,
        dateTo: payload.dateTo,
        totalRequests,
        rowsInserted,
        failedOrigins: failedOrigins.length,
        durationMs,
        runId: payload.crawlRunId,
      });

      if (failedOrigins.length > 0) {
        logger.warn("Some origins failed", { failedOrigins });
      }

      incCounter("crawl.range.fanout.rows_inserted", rowsInserted, { "airline.code": "FR" });
      incCounter("crawl.range.fanout.requests_made", totalRequests, { "airline.code": "FR" });

      trace.finish({
        rows_inserted: rowsInserted,
        requests_made: totalRequests,
        origins_scanned: payload.origins.length,
        duration_ms: durationMs,
        failed_origins: failedOrigins.length,
      });

      return RyanairRangeFanOutOutput.parse({
        crawlRunId: payload.crawlRunId,
        origins: payload.origins,
        dateFrom: payload.dateFrom,
        dateTo: payload.dateTo,
        totalRequests,
        rowsInserted,
        durationMs,
      });
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      trace.fail(err, { duration_ms: durationMs });
      throw err;
    }
  },
});
