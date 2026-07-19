import { emitGauge, emitLog, emitSpan, isOtelEnabled, nowNs, setActiveTaskContext } from ".";
import { newSpanId } from "./ids";
import { newTraceId } from "./ids";
import type { TraceContext } from "./context";

/**
 * Return an async function that records span/metrics for a trigger.dev
 * task run. The returned `traceTask` MUST be called inside the task's
 * `run()` so it can establish the trace context before any work.
 *
 * Trace id is derived from `runId` so it correlates perfectly with the
 * crawl_run_id already used in flight_listings and crawl_progress.
 *
 * `start()` installs the task's trace context as the *active task context*
 * for the rest of the process so that every span / log / withSpan / HTTP
 * invocation done by the task inherits the same trace id without having
 * to plumb AsyncLocalStorage explicitly. `finish()` / `fail()` clear the
 * active context and emit the task-level root span.
 */
export function traceTask(opts: {
  name: string;
  runId: string;
  attributes?: Record<string, string>;
  kind?: "INTERNAL" | "SERVER" | "CLIENT" | "PRODUCER" | "CONSUMER";
}): {
  start: () => void;
  finish: (summary?: Record<string, string | number | boolean>) => void;
  fail: (err: unknown, summary?: Record<string, string | number | boolean>) => void;
} {
  const startNs = nowNs();
  const taskCtx: TraceContext = {
    traceId: newTraceId(opts.runId),
    spanId: newSpanId(),
    attributes: {
      "task.name": opts.name,
      "task.run_id": opts.runId,
      ...(opts.attributes ?? {}),
    },
  };
  return {
    start: () => {
      if (!isOtelEnabled()) return;
      setActiveTaskContext(taskCtx);
    },
    finish: (summary) => {
      const endNs = nowNs();
      try {
        if (!isOtelEnabled()) return;
        const attrs: Record<string, string> = {};
        for (const [k, v] of Object.entries(summary ?? {})) attrs[k] = String(v);
        emitSpan({
          name: opts.name,
          kind: opts.kind ?? "INTERNAL",
          startNs,
          endNs,
          statusCode: "OK",
          attributes: attrs,
          parentSpanId: "",
          traceIdOverride: taskCtx.traceId,
        });
        emitLog({
          severity: "INFO",
          body: `${opts.name} completed`,
          attributes: { ...attrs, "task.name": opts.name, "task.run_id": opts.runId },
          eventName: `task.${opts.name}.success`,
        });
        for (const [k, v] of Object.entries(attrs)) {
          if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) {
            emitGauge({ name: k, value: Number(v), attributes: { "task.name": opts.name } });
          }
        }
      } finally {
        setActiveTaskContext(null);
      }
    },
    fail: (err, summary) => {
      const endNs = nowNs();
      try {
        if (!isOtelEnabled()) return;
        const attrs: Record<string, string> = {};
        for (const [k, v] of Object.entries(summary ?? {})) attrs[k] = String(v);
        const e = err as Error;
        emitSpan({
          name: opts.name,
          kind: opts.kind ?? "INTERNAL",
          startNs,
          endNs,
          statusCode: "ERROR",
          statusMessage: e?.message ?? String(err),
          attributes: {
            ...attrs,
            "error.type": e?.name ?? "Error",
            "error.message": e?.message ?? String(err),
          },
          parentSpanId: "",
          traceIdOverride: taskCtx.traceId,
        });
        emitLog({
          severity: "ERROR",
          body: `${opts.name} failed: ${e?.message ?? err}`,
          attributes: {
            ...attrs,
            "task.name": opts.name,
            "task.run_id": opts.runId,
            "error.type": e?.name ?? "Error",
            "error.message": e?.message ?? String(err),
          },
          eventName: `task.${opts.name}.failure`,
        });
      } finally {
        setActiveTaskContext(null);
      }
    },
  };
}

/**
 * Convenience for per-record counters that should accumulate as Sum metrics
 * for the duration of a crawl (e.g. requests_made, rows_inserted).
 */
export function incCounter(
  name: string,
  delta: number,
  attrs: Record<string, string> = {}
): void {
  emitGauge({ name, value: delta, attributes: attrs });
  void newSpanId;
}
