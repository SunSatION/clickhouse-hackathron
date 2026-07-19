import { getClickHouseForOtel } from "../db/clickhouse";
import { currentContext } from "./context";

export type Severity = "TRACE" | "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL";

export type OtelResource = {
  serviceName: string;
  serviceVersion?: string;
  deploymentEnvironment?: string;
  /** extra static resource.* attributes */
  attributes?: Record<string, string>;
};

export type OtelScope = {
  name: string;
  version?: string;
};

export type EmitLogInput = {
  severity: Severity;
  body: string;
  attributes?: Record<string, string>;
  /** event name (ClickStack surfaces this in the Events tab) */
  eventName?: string;
  /** explicit timestamp in microseconds, defaults to now */
  timestampMicros?: number;
};

export type EmitSpanInput = {
  name: string;
  kind?: "INTERNAL" | "SERVER" | "CLIENT" | "PRODUCER" | "CONSUMER";
  startNs: bigint;
  endNs: bigint;
  statusCode?: "OK" | "ERROR" | "UNSET";
  statusMessage?: string;
  attributes?: Record<string, string>;
  /** override the parent span id (defaults to current context's span) */
  parentSpanId?: string;
  traceIdOverride?: string;
};

export type EmitGaugeInput = {
  name: string;
  description?: string;
  unit?: string;
  value: number;
  attributes?: Record<string, string>;
  timeUnix?: Date;
};

export type EmitSumInput = {
  name: string;
  description?: string;
  unit?: string;
  /** positive delta to add; choose one of value or delta. */
  value?: number;
  delta?: number;
  isMonotonic?: boolean;
  attributes?: Record<string, string>;
  timeUnix?: Date;
};

export type EmitHistogramInput = {
  name: string;
  description?: string;
  unit?: string;
  /** observed value (recorded into the histogram) */
  value: number;
  attributes?: Record<string, string>;
  timeUnix?: Date;
};

export type OtelConfig = {
  resource: OtelResource;
  scope: OtelScope;
  flushIntervalMs?: number;
  batchSize?: number;
  /** when false, all emitters become no-ops (handy for tests). */
  enabled?: boolean;
};

const SEVERITY_TO_NUMBER: Record<Severity, number> = {
  TRACE: 1,
  DEBUG: 5,
  INFO: 9,
  WARN: 13,
  ERROR: 17,
  FATAL: 21,
};

type LogRow = Record<string, unknown>;
type SpanRow = Record<string, unknown>;
type GaugeRow = Record<string, unknown>;
type SumRow = Record<string, unknown>;
type HistogramRow = Record<string, unknown>;

const DEFAULT_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300,
];

let _config: OtelConfig | null = null;
let _flushTimer: NodeJS.Timeout | null = null;

const logQueue: LogRow[] = [];
const spanQueue: SpanRow[] = [];
const gaugeQueue: GaugeRow[] = [];
const sumQueue: SumRow[] = [];
const histQueue: HistogramRow[] = [];

export function configureOtel(config: Partial<OtelConfig> & { resource?: Partial<OtelResource> }): OtelConfig {
  _config = {
    resource: {
      serviceName: config.resource?.serviceName ?? process.env.OTEL_SERVICE_NAME ?? "hackathron-crawler",
      serviceVersion: config.resource?.serviceVersion ?? process.env.npm_package_version ?? "0.0.0",
      deploymentEnvironment:
        config.resource?.deploymentEnvironment ?? process.env.NODE_ENV ?? "development",
      attributes: config.resource?.attributes ?? {},
    },
    scope: {
      name: config.scope?.name ?? "@hackathron/observability",
      version: config.scope?.version ?? "0.1.0",
    },
    flushIntervalMs: config.flushIntervalMs ?? 1500,
    batchSize: config.batchSize ?? 1000,
    enabled: config.enabled ?? (process.env.OTEL_ENABLE ?? "1") !== "0",
  };
  if (_flushTimer) clearInterval(_flushTimer);
  _flushTimer = setInterval(() => {
    void flush().catch(() => undefined);
  }, _config.flushIntervalMs);
  if (typeof _flushTimer.unref === "function") _flushTimer.unref();
  return _config;
}

export function getOtelConfig(): OtelConfig | null {
  return _config;
}

export function isOtelEnabled(): boolean {
  return Boolean(_config?.enabled);
}

function ch() {
  return getClickHouseForOtel();
}

function requireConfig(): OtelConfig {
  if (!_config) configureOtel({});
  return _config!;
}

function scheduleFlushOnBatch(): void {
  const cfg = requireConfig();
  const total =
    logQueue.length +
    spanQueue.length +
    gaugeQueue.length +
    sumQueue.length +
    histQueue.length;
  if (total >= (cfg.batchSize ?? 1000)) {
    void flush().catch(() => undefined);
  }
}

async function safeInsert(table: string, format: "JSONEachRow", values: unknown[]): Promise<void> {
  if (values.length === 0) return;
  try {
    await ch().insert({ table, format, values });
  } catch (err) {
    process.stderr.write(`[observability] insert into ${table} failed: ${(err as Error).message}\n`);
  }
}

export async function flush(): Promise<void> {
  if (!_config || !_config.enabled) return;
  const drain = <T,>(arr: T[]) => arr.splice(0, arr.length);
  const logs = drain(logQueue);
  const spans = drain(spanQueue);
  const gauges = drain(gaugeQueue);
  const sums = drain(sumQueue);
  const hist = drain(histQueue);
  await Promise.all([
    safeInsert("otel_logs", "JSONEachRow", logs),
    safeInsert("otel_traces", "JSONEachRow", spans),
    safeInsert("otel_metrics_gauge", "JSONEachRow", gauges),
    safeInsert("otel_metrics_sum", "JSONEachRow", sums),
    safeInsert("otel_metrics_histogram", "JSONEachRow", hist),
  ]);
}

function buildResourceAttrs(extra?: Record<string, string>): Record<string, string> {
  const cfg = requireConfig();
  const out: Record<string, string> = {
    "service.name": cfg.resource.serviceName,
    "service.version": cfg.resource.serviceVersion ?? "",
    "deployment.environment.name": cfg.resource.deploymentEnvironment ?? "",
    ...cfg.resource.attributes,
  };
  if (extra) Object.assign(out, extra);
  return out;
}

export function emitLog(input: EmitLogInput): void {
  const cfg = _config;
  if (!cfg || !cfg.enabled) return;
  const ctx = currentContext();
  const tsMicros = input.timestampMicros ?? Date.now() * 1000;
  const row: LogRow = {
    Timestamp: new Date(tsMicros / 1000).toISOString(),
    TraceId: ctx.traceId,
    SpanId: ctx.spanId,
    TraceFlags: 1,
    SeverityText: input.severity,
    SeverityNumber: SEVERITY_TO_NUMBER[input.severity],
    ServiceName: cfg.resource.serviceName,
    Body: input.body,
    ResourceSchemaUrl: "",
    ResourceAttributes: buildResourceAttrs(ctx.attributes),
    ScopeSchemaUrl: "",
    ScopeName: cfg.scope.name,
    ScopeVersion: cfg.scope.version ?? "",
    ScopeAttributes: {},
    LogAttributes: input.attributes ?? {},
    EventName: input.eventName ?? "",
  };
  logQueue.push(row);
  scheduleFlushOnBatch();
}

export function emitSpan(input: EmitSpanInput): void {
  const cfg = _config;
  if (!cfg || !cfg.enabled) return;
  const ctx = currentContext();
  const startMicros = Number(input.startNs / 1000n);
  const endMicros = Number(input.endNs / 1000n);
  const startIso = new Date(startMicros / 1000).toISOString();
  const duration = endMicros - startMicros;
  const spanRow: SpanRow = {
    Timestamp: startIso,
    TraceId: input.traceIdOverride ?? ctx.traceId,
    SpanId: ctx.spanId,
    ParentSpanId: input.parentSpanId ?? "",
    TraceState: ctx.traceState ?? "",
    SpanName: input.name,
    SpanKind: input.kind ?? "INTERNAL",
    ServiceName: cfg.resource.serviceName,
    ResourceAttributes: buildResourceAttrs(ctx.attributes),
    ScopeName: cfg.scope.name,
    ScopeVersion: cfg.scope.version ?? "",
    SpanAttributes: input.attributes ?? {},
    Duration: Math.max(0, duration),
    StatusCode: input.statusCode ?? "UNSET",
    StatusMessage: input.statusMessage ?? "",
    "Events.Timestamp": [],
    "Events.Name": [],
    "Events.Attributes": [],
  };
  spanQueue.push(spanRow);
  scheduleFlushOnBatch();
}

export function emitGauge(input: EmitGaugeInput): void {
  const cfg = _config;
  if (!cfg || !cfg.enabled) return;
  const now = (input.timeUnix ?? new Date()).toISOString().slice(0, 19).replace("T", " ");
  const row: GaugeRow = {
    ResourceAttributes: buildResourceAttrs(),
    ResourceSchemaUrl: "",
    ScopeName: cfg.scope.name,
    ScopeVersion: cfg.scope.version ?? "",
    ScopeAttributes: {},
    ServiceName: cfg.resource.serviceName,
    MetricName: input.name,
    MetricDescription: input.description ?? "",
    MetricUnit: input.unit ?? "",
    Attributes: input.attributes ?? {},
    StartTimeUnix: now,
    TimeUnix: now,
    Value: input.value,
    Flags: 0,
  };
  gaugeQueue.push(row);
  scheduleFlushOnBatch();
}

export function emitSum(input: EmitSumInput): void {
  const cfg = _config;
  if (!cfg || !cfg.enabled) return;
  const now = (input.timeUnix ?? new Date()).toISOString().slice(0, 19).replace("T", " ");
  const value = input.value ?? input.delta ?? 0;
  const row: SumRow = {
    ResourceAttributes: buildResourceAttrs(),
    ResourceSchemaUrl: "",
    ScopeName: cfg.scope.name,
    ScopeVersion: cfg.scope.version ?? "",
    ScopeAttributes: {},
    ServiceName: cfg.resource.serviceName,
    MetricName: input.name,
    MetricDescription: input.description ?? "",
    MetricUnit: input.unit ?? "",
    Attributes: input.attributes ?? {},
    StartTimeUnix: now,
    TimeUnix: now,
    Value: value,
    Flags: 0,
    AggregationTemporality: 1,
    IsMonotonic: input.isMonotonic ?? false,
  };
  sumQueue.push(row);
  scheduleFlushOnBatch();
}

export function emitHistogram(input: EmitHistogramInput): void {
  const cfg = _config;
  if (!cfg || !cfg.enabled) return;
  const now = (input.timeUnix ?? new Date()).toISOString().slice(0, 19).replace("T", " ");
  const row: HistogramRow = {
    ResourceAttributes: buildResourceAttrs(),
    ResourceSchemaUrl: "",
    ScopeName: cfg.scope.name,
    ScopeVersion: cfg.scope.version ?? "",
    ScopeAttributes: {},
    ServiceName: cfg.resource.serviceName,
    MetricName: input.name,
    MetricDescription: input.description ?? "",
    MetricUnit: input.unit ?? "",
    Attributes: input.attributes ?? {},
    StartTimeUnix: now,
    TimeUnix: now,
    Count: 1,
    Sum: input.value,
    BucketCounts: DEFAULT_BUCKETS.map(() => 0),
    ExplicitBounds: DEFAULT_BUCKETS,
    Flags: 0,
    Min: input.value,
    Max: input.value,
    AggregationTemporality: 1,
  };
  histQueue.push(row);
  scheduleFlushOnBatch();
}

export async function shutdownOtel(): Promise<void> {
  if (_flushTimer) clearInterval(_flushTimer);
  await flush();
}
