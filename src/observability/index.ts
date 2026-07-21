import { configureOtel, emitGauge, emitHistogram, emitLog, emitSpan, emitSum, isOtelEnabled, shutdownOtel } from "./emitter.js";
import { otelLogger, withSpan, type OtelLogger } from "./logger.js";
import {
  childContext,
  currentContext,
  getActiveTaskContext,
  getRootContext,
  runWithContext,
  setActiveTaskContext,
  type TraceContext,
} from "./context.js";
import { newSpanId, newTraceId, nowMicros, nowNs, nanoDiff } from "./ids.js";
import { instrumentedFetch, installFetchInstrumentation } from "./instrumentation.js";
import { traceTask, incCounter } from "./task.js";

export {
  configureOtel,
  emitGauge,
  emitHistogram,
  emitLog,
  emitSpan,
  emitSum,
  isOtelEnabled,
  shutdownOtel,
  otelLogger,
  withSpan,
  childContext,
  currentContext,
  getActiveTaskContext,
  getRootContext,
  runWithContext,
  setActiveTaskContext,
  newSpanId,
  newTraceId,
  nowMicros,
  nowNs,
  nanoDiff,
  instrumentedFetch,
  installFetchInstrumentation,
  traceTask,
  incCounter,
};

export type { OtelLogger, TraceContext };
