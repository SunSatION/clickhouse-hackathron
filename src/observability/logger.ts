import type { Severity } from "./emitter";
import { emitLog, emitSpan, isOtelEnabled } from "./emitter";
import { currentContext, runWithContext, type TraceContext } from "./context";
import { newSpanId, nowNs } from "./ids";

export type OtelLogger = {
  trace: (msg: string, meta?: Record<string, unknown>) => void;
  debug: (msg: string, meta?: Record<string, unknown>) => void;
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
};

function asString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function flatten(prefix: string, value: unknown, out: Record<string, string>): void {
  if (value === null || value === undefined) {
    out[prefix] = "";
  } else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    out[prefix] = String(value);
  } else if (Array.isArray(value)) {
    out[prefix] = value.map(asString).join(",");
  } else if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      flatten(prefix ? `${prefix}.${k}` : k, v, out);
    }
  } else {
    out[prefix] = String(value);
  }
}

function flatRecord(v: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!v) return out;
  flatten("", v, out);
  return out;
}

function emit(severity: Severity, msg: string, meta?: Record<string, unknown>): void {
  if (!isOtelEnabled()) return;
  const attrs = flatRecord(meta);
  emitLog({ severity, body: msg, attributes: attrs });
}

export function otelLogger(): OtelLogger {
  return {
    trace: (msg, meta) => emit("DEBUG", msg, meta),
    debug: (msg, meta) => emit("DEBUG", msg, meta),
    info: (msg, meta) => emit("INFO", msg, meta),
    warn: (msg, meta) => emit("WARN", msg, meta),
    error: (msg, meta) => emit("ERROR", msg, meta),
  };
}

/**
 * Run `fn` as a child span of the current trace context. A single span row
 * is emitted on completion (or rejection) using the start/end timestamps
 * captured around the function. The new context inherits the parent's
 * trace id and resource attributes but gets a fresh span id.
 */
export async function withSpan<T>(
  name: string,
  fn: () => Promise<T> | T,
  attrs: Record<string, unknown> = {}
): Promise<T> {
  if (!isOtelEnabled()) {
    return await fn();
  }
  const parent = currentContext();
  const parentSpan = parent.spanId;
  const parentTrace = parent.traceId;
  const ctx: TraceContext = {
    traceId: parentTrace,
    spanId: newSpanId(),
    attributes: { ...parent.attributes, ...flatRecord(attrs) },
  };
  const start = nowNs();
  try {
    const value = await runWithContext(ctx, fn);
    emitSpan({
      name,
      kind: "INTERNAL",
      startNs: start,
      endNs: nowNs(),
      statusCode: "OK",
      parentSpanId: parentSpan,
      traceIdOverride: parentTrace,
      attributes: flatRecord(attrs),
    });
    return value;
  } catch (err) {
    emitSpan({
      name,
      kind: "INTERNAL",
      startNs: start,
      endNs: nowNs(),
      statusCode: "ERROR",
      parentSpanId: parentSpan,
      traceIdOverride: parentTrace,
      statusMessage: (err as Error)?.message ?? String(err),
      attributes: {
        ...flatRecord(attrs),
        "error.type": (err as Error)?.name ?? "Error",
        "error.message": (err as Error)?.message ?? String(err),
      },
    });
    throw err;
  }
}
