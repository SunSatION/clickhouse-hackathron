import { configureOtel, emitGauge, emitHistogram, emitLog, emitSpan, emitSum, isOtelEnabled, shutdownOtel } from "./emitter";
import { otelLogger, withSpan, type OtelLogger } from "./logger";
import {
  childContext,
  currentContext,
  getActiveTaskContext,
  getRootContext,
  runWithContext,
  setActiveTaskContext,
  type TraceContext,
} from "./context";
import { newSpanId, newTraceId, nowMicros, nowNs, nanoDiff } from "./ids";
import { instrumentedFetch, installFetchInstrumentation } from "./instrumentation";
import { traceTask, incCounter } from "./task";

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
