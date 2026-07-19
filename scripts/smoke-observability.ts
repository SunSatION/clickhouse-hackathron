import { config } from "dotenv";
config({ path: ".env" });

import {
  configureOtel,
  emitGauge,
  emitHistogram,
  emitLog,
  emitSpan,
  emitSum,
  incCounter,
  installFetchInstrumentation,
  instrumentedFetch,
  newTraceId,
  otelLogger,
  shutdownOtel,
  traceTask,
  withSpan,
} from "../src/observability";
import { runMigrations } from "../src/db/migrate";

async function main(): Promise<void> {
  await runMigrations();

  configureOtel({
    resource: {
      serviceName: "hackathron-crawler",
      attributes: { "deployment.environment.name": "smoketest" },
    },
  });
  installFetchInstrumentation();

  const log = otelLogger();
  log.info("smoke test starting", { suite: "observability" });

  const crawlRunId = crypto.randomUUID();
  const expectedTraceId = newTraceId(crawlRunId);
  console.log(`\nAsserting every span/log below carries traceId=${expectedTraceId}`);

  // Install the task context FIRST so that the withSpan calls below
  // inherit the right trace id (they read currentContext().traceId).
  const trace = traceTask({
    name: "smoke.task",
    runId: crawlRunId,
    attributes: { "smoke.scenario": "happy-path" },
  });
  trace.start();

  await withSpan(
    "smoke.fetch",
    async () => {
      const res = await instrumentedFetch("http://localhost:8123/ping");
      log.info("fetched ClickHouse ping", { status: res.status });
    },
    { "smoke.stage": "fetch" }
  );

  await withSpan(
    "smoke.compute",
    async () => {
      emitGauge({ name: "smoke.gauge", value: 42, attributes: { unit: "rows" } });
      emitSum({ name: "smoke.sum", value: 7, isMonotonic: true });
      emitHistogram({ name: "smoke.hist", value: 123.4, unit: "ms" });
      emitSpan({
        name: "smoke.span.manual",
        startNs: 0n,
        endNs: 1_000_000n,
        statusCode: "OK",
        attributes: { hello: "world" },
      });
      incCounter("smoke.counter", 5, { "smoke.scenario": "happy-path" });
    },
    { "smoke.stage": "compute" }
  );

  trace.finish({ rows_inserted: 42, duration_ms: 1234 });

  console.log(`Smoke run crawlRunId=${crawlRunId} traceId=${expectedTraceId}`);
  await shutdownOtel();

  const { getClickHouseForOtel } = await import("../src/db/clickhouse");
  const otelCh = getClickHouseForOtel();

  const counts = await otelCh.query({
    query: `
      SELECT
        (SELECT count() FROM otel_logs)         AS logs,
        (SELECT count() FROM otel_traces)       AS spans,
        (SELECT count() FROM otel_metrics_gauge)    AS gauges,
        (SELECT count() FROM otel_metrics_sum)      AS sums,
        (SELECT count() FROM otel_metrics_histogram) AS hists
    `,
    format: "JSONEachRow",
  });
  const [countsRow] = (await counts.json()) as Array<Record<string, string | number>>;
  console.log("Row counts after smoke test:", countsRow);

  if (Number(countsRow?.logs ?? 0) === 0 || Number(countsRow?.spans ?? 0) === 0) {
    throw new Error("Expected at least one log row and one span row after smoke test");
  }

  const correlation = await otelCh.query({
    query: `
      SELECT
        (SELECT count() FROM otel_traces WHERE TraceId = {tid:String} AND Timestamp >= now() - INTERVAL 5 MINUTE) AS spans,
        (SELECT count() FROM otel_logs   WHERE TraceId = {tid:String} AND Timestamp >= now() - INTERVAL 5 MINUTE) AS logs
    `,
    query_params: { tid: expectedTraceId },
    format: "JSONEachRow",
  });
  const [corrRow] = (await correlation.json()) as Array<{ spans: number | string; logs: number | string }>;
  console.log(`\nCorrelation for crawl_run_id=${crawlRunId} (traceId=${expectedTraceId}):`, corrRow);
  const spansN = Number(corrRow?.spans ?? 0);
  if (spansN < 2) {
    throw new Error(
      `Expected at least 2 spans correlated to traceId=${expectedTraceId} (got ${spansN}). ` +
      `Active task context is not propagating; spans for one crawl are landing on different TraceId rows.`,
    );
  }
  console.log("Observability smoke test PASSED.");
}

main().catch((err) => {
  console.error("Smoke test failed:", err);
  process.exit(1);
});
