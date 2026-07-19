import { metadata, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";

import {
  configureOtel,
  emitGauge,
  installFetchInstrumentation,
  traceTask,
} from "../observability";
import { syncRyanairRoutesFromAirports } from "../airlines/ryanair";
import { TASK_DESCRIPTIONS } from "./task-descriptions";

configureOtel({
  resource: {
    serviceName: "hackathron-crawler",
    attributes: { "app.component": "sync-ryanair-routes" },
  },
});
installFetchInstrumentation();

export const syncRyanairRoutes = schemaTask({
  id: "sync-ryanair-routes",
  description: TASK_DESCRIPTIONS["sync-ryanair-routes"].summary,
  schema: z.object({
    concurrency: z.number().int().min(1).max(20).default(1),
  }),
  queue: { concurrencyLimit: 1 },
  maxDuration: 86400,
  retry: {
    maxAttempts: 1,
  },
  run: async (payload) => {
    const trace = traceTask({
      name: "sync-ryanair-routes",
      runId: crypto.randomUUID(),
      attributes: {
        "sync.concurrency": String(payload.concurrency),
        "airline.code": "FR",
      },
    });
    trace.start();
    metadata.set("concurrency", payload.concurrency);

    const summary = await syncRyanairRoutesFromAirports({
      concurrency: payload.concurrency,
      onProgress: (done, total, origin, n) => {
        if (done % 10 === 0 || done === total) {
          metadata.set("progress", `${done}/${total}`);
        }
        if (n < 0) {
          metadata.set(`fail.${origin}`, true);
        } else {
          emitGauge({
            name: "sync.routes_per_origin",
            value: n,
            attributes: { origin },
          });
        }
      },
    });

    metadata.set("airports", summary.airports);
    metadata.set("originsSucceeded", summary.originsSucceeded);
    metadata.set("originsFailed", summary.originsFailed.length);
    metadata.set("totalDestinations", summary.totalDestinations);
    metadata.set("durationMs", summary.durationMs);

    trace.finish({
      airports: summary.airports,
      origins_succeeded: summary.originsSucceeded,
      origins_failed: summary.originsFailed.length,
      total_destinations: summary.totalDestinations,
      duration_ms: summary.durationMs,
    });

    return {
      airports: summary.airports,
      originsSucceeded: summary.originsSucceeded,
      originsFailed: summary.originsFailed,
      totalDestinations: summary.totalDestinations,
      durationMs: summary.durationMs,
    };
  },
});