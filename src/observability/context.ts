import { AsyncLocalStorage } from "node:async_hooks";
import { newSpanId, newTraceId } from "./ids.js";

export type TraceContext = {
  traceId: string;
  spanId: string;
  /** W3C trace state, free-form string. */
  traceState?: string;
  /** Resource attributes to apply at log/span emission time. */
  attributes: Record<string, string>;
};

const storage = new AsyncLocalStorage<TraceContext>();

const ROOT: TraceContext = {
  traceId: newTraceId(),
  spanId: newSpanId(),
  attributes: {},
};

/**
 * Long-lived trace context the rest of the process adopts while a task is
 * running. Trigger.dev tasks run with `concurrencyLimit: 1` per process so
 * a single module-level "active task" context is safe. Without this, all
 * spans emitted between `traceTask().start()` and `finish()`/`fail()` would
 * fall back to ROOT and the trace id derived from `crawl_run_id` would
 * only show the root span — every child span would land on a different
 * trace, which broke the HyperDX correlation flow.
 */
let _activeTaskContext: TraceContext | null = null;

export function setActiveTaskContext(ctx: TraceContext | null): void {
  _activeTaskContext = ctx;
}

export function currentContext(): TraceContext {
  return storage.getStore() ?? _activeTaskContext ?? ROOT;
}

export function runWithContext<T>(ctx: TraceContext, fn: () => T | Promise<T>): T | Promise<T> {
  return storage.run(ctx, fn);
}

/**
 * Start a new logical "operation" inside an existing trace. The returned
 * ctx has the previous span as its parent and a fresh span id, so any
 * logs/spans emitted from inside `fn` attach to the same trace.
 */
export function childContext(
  overrides: Partial<TraceContext> & { attributes?: Record<string, string> } = {}
): TraceContext {
  const cur = currentContext();
  return {
    traceId: overrides.traceId ?? cur.traceId,
    spanId: newSpanId(),
    traceState: overrides.traceState ?? cur.traceState,
    attributes: { ...cur.attributes, ...(overrides.attributes ?? {}) },
  };
}

export function getRootContext(): TraceContext {
  return ROOT;
}

export function getActiveTaskContext(): TraceContext | null {
  return _activeTaskContext;
}
