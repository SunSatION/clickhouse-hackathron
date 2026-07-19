-- ClickStack (HyperDX + ClickHouse) observability schema.
-- These tables are the exact shape the ClickStack OTel collector / HyperDX UI
-- expects to query. We materialise them locally so the rest of the app can
-- push data into them directly (matching what the clickhouse exporter does).
--
-- The OTel collector image targets the database set via
-- HYPERDX_OTEL_EXPORTER_CLICKHOUSE_DATABASE. Point it at this same database
-- (`flights` by default) and ClickStack will pick the data up automatically.
--
-- Reference: https://clickhouse.com/docs/use-cases/observability/clickstack/ingesting-data/schemas

CREATE TABLE IF NOT EXISTS otel_logs
(
  `Timestamp` DateTime64(9) CODEC(Delta(8), ZSTD(1)),
  `TraceId` String CODEC(ZSTD(1)),
  `SpanId` String CODEC(ZSTD(1)),
  `TraceFlags` UInt8,
  `SeverityText` LowCardinality(String) CODEC(ZSTD(1)),
  `SeverityNumber` UInt8,
  `ServiceName` LowCardinality(String) CODEC(ZSTD(1)),
  `Body` String CODEC(ZSTD(1)),
  `ResourceSchemaUrl` LowCardinality(String) CODEC(ZSTD(1)),
  `ResourceAttributes` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
  `ScopeSchemaUrl` LowCardinality(String) CODEC(ZSTD(1)),
  `ScopeName` String CODEC(ZSTD(1)),
  `ScopeVersion` LowCardinality(String) CODEC(ZSTD(1)),
  `ScopeAttributes` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
  `LogAttributes` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
  `EventName` String CODEC(ZSTD(1)),
  INDEX idx_trace_id TraceId TYPE text(tokenizer = 'array'),
  INDEX idx_res_attr_key mapKeys(ResourceAttributes) TYPE text(tokenizer = 'array'),
  INDEX idx_scope_attr_key mapKeys(ScopeAttributes) TYPE text(tokenizer = 'array'),
  INDEX idx_log_attr_key mapKeys(LogAttributes) TYPE text(tokenizer = 'array'),
  INDEX idx_lower_body lower(Body) TYPE text(tokenizer = 'splitByNonAlpha')
)
ENGINE = MergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (toStartOfFiveMinutes(Timestamp), ServiceName, Timestamp)
TTL toDateTime(Timestamp) + INTERVAL 30 DAY
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

CREATE TABLE IF NOT EXISTS otel_traces
(
  `Timestamp` DateTime64(9) CODEC(Delta(8), ZSTD(1)),
  `TraceId` String CODEC(ZSTD(1)),
  `SpanId` String CODEC(ZSTD(1)),
  `ParentSpanId` String CODEC(ZSTD(1)),
  `TraceState` String CODEC(ZSTD(1)),
  `SpanName` LowCardinality(String) CODEC(ZSTD(1)),
  `SpanKind` LowCardinality(String) CODEC(ZSTD(1)),
  `ServiceName` LowCardinality(String) CODEC(ZSTD(1)),
  `ResourceAttributes` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
  `ScopeName` String CODEC(ZSTD(1)),
  `ScopeVersion` String CODEC(ZSTD(1)),
  `SpanAttributes` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
  `Duration` UInt64 CODEC(ZSTD(1)),
  `StatusCode` LowCardinality(String) CODEC(ZSTD(1)),
  `StatusMessage` String CODEC(ZSTD(1)),
  `Events.Timestamp` Array(DateTime64(9)) CODEC(ZSTD(1)),
  `Events.Name` Array(LowCardinality(String)) CODEC(ZSTD(1)),
  `Events.Attributes` Array(Map(LowCardinality(String), String)) CODEC(ZSTD(1)),
  INDEX idx_trace_id TraceId TYPE bloom_filter(0.001) GRANULARITY 1,
  INDEX idx_res_attr_key mapKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  INDEX idx_span_attr_key mapKeys(SpanAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  INDEX idx_duration Duration TYPE minmax GRANULARITY 1
)
ENGINE = MergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (ServiceName, SpanName, toDateTime(Timestamp))
TTL toDateTime(Timestamp) + INTERVAL 30 DAY
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

CREATE TABLE IF NOT EXISTS otel_metrics_gauge
(
  `ResourceAttributes` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
  `ResourceSchemaUrl` String CODEC(ZSTD(1)),
  `ScopeName` String CODEC(ZSTD(1)),
  `ScopeVersion` String CODEC(ZSTD(1)),
  `ScopeAttributes` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
  `ServiceName` LowCardinality(String) CODEC(ZSTD(1)),
  `MetricName` LowCardinality(String) CODEC(ZSTD(1)),
  `MetricDescription` String CODEC(ZSTD(1)),
  `MetricUnit` String CODEC(ZSTD(1)),
  `Attributes` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
  `StartTimeUnix` DateTime CODEC(Delta, ZSTD(1)),
  `TimeUnix` DateTime CODEC(Delta, ZSTD(1)),
  `Value` Float64 CODEC(ZSTD(1)),
  `Flags` UInt32 CODEC(ZSTD(1)),
  INDEX idx_metric_name MetricName TYPE bloom_filter(0.01) GRANULARITY 1,
  INDEX idx_attr_key mapKeys(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  INDEX idx_time_minmax TimeUnix TYPE minmax GRANULARITY 1
)
ENGINE = MergeTree
PARTITION BY toDate(TimeUnix)
ORDER BY (ServiceName, MetricName, toStartOfHour(TimeUnix), cityHash64(Attributes), TimeUnix)
TTL toDateTime(TimeUnix) + INTERVAL 30 DAY
SETTINGS ttl_only_drop_parts = 1;

CREATE TABLE IF NOT EXISTS otel_metrics_sum
(
  `ResourceAttributes` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
  `ResourceSchemaUrl` String CODEC(ZSTD(1)),
  `ScopeName` String CODEC(ZSTD(1)),
  `ScopeVersion` String CODEC(ZSTD(1)),
  `ScopeAttributes` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
  `ServiceName` LowCardinality(String) CODEC(ZSTD(1)),
  `MetricName` LowCardinality(String) CODEC(ZSTD(1)),
  `MetricDescription` String CODEC(ZSTD(1)),
  `MetricUnit` String CODEC(ZSTD(1)),
  `Attributes` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
  `StartTimeUnix` DateTime CODEC(Delta, ZSTD(1)),
  `TimeUnix` DateTime CODEC(Delta, ZSTD(1)),
  `Value` Float64 CODEC(ZSTD(1)),
  `Flags` UInt32 CODEC(ZSTD(1)),
  `AggregationTemporality` Int32 CODEC(ZSTD(1)),
  `IsMonotonic` Bool CODEC(ZSTD(1)),
  INDEX idx_metric_name MetricName TYPE bloom_filter(0.01) GRANULARITY 1,
  INDEX idx_attr_key mapKeys(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  INDEX idx_time_minmax TimeUnix TYPE minmax GRANULARITY 1
)
ENGINE = MergeTree
PARTITION BY toDate(TimeUnix)
ORDER BY (ServiceName, MetricName, toStartOfHour(TimeUnix), cityHash64(Attributes), TimeUnix)
TTL toDateTime(TimeUnix) + INTERVAL 30 DAY
SETTINGS ttl_only_drop_parts = 1;

CREATE TABLE IF NOT EXISTS otel_metrics_histogram
(
  `ResourceAttributes` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
  `ResourceSchemaUrl` String CODEC(ZSTD(1)),
  `ScopeName` String CODEC(ZSTD(1)),
  `ScopeVersion` String CODEC(ZSTD(1)),
  `ScopeAttributes` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
  `ServiceName` LowCardinality(String) CODEC(ZSTD(1)),
  `MetricName` LowCardinality(String) CODEC(ZSTD(1)),
  `MetricDescription` String CODEC(ZSTD(1)),
  `MetricUnit` String CODEC(ZSTD(1)),
  `Attributes` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
  `StartTimeUnix` DateTime CODEC(Delta, ZSTD(1)),
  `TimeUnix` DateTime CODEC(Delta, ZSTD(1)),
  `Count` UInt64 CODEC(Delta(8), ZSTD(1)),
  `Sum` Float64 CODEC(ZSTD(1)),
  `BucketCounts` Array(UInt64) CODEC(ZSTD(1)),
  `ExplicitBounds` Array(Float64) CODEC(ZSTD(1)),
  `Flags` UInt32 CODEC(ZSTD(1)),
  `Min` Float64 CODEC(ZSTD(1)),
  `Max` Float64 CODEC(ZSTD(1)),
  `AggregationTemporality` Int32 CODEC(ZSTD(1)),
  INDEX idx_metric_name MetricName TYPE bloom_filter(0.01) GRANULARITY 1,
  INDEX idx_attr_key mapKeys(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  INDEX idx_time_minmax TimeUnix TYPE minmax GRANULARITY 1
)
ENGINE = MergeTree
PARTITION BY toDate(TimeUnix)
ORDER BY (ServiceName, MetricName, toStartOfHour(TimeUnix), cityHash64(Attributes), TimeUnix)
TTL toDateTime(TimeUnix) + INTERVAL 30 DAY
SETTINGS ttl_only_drop_parts = 1;

-- Convenience view used by HyperDX dashboard widgets.
CREATE OR REPLACE VIEW v_crawl_otel_summary AS
SELECT
  toStartOfFiveMinute(Timestamp) AS bucket,
  ServiceName,
  SpanName,
  count() AS span_count,
  sum(Duration) / 1e6 AS total_duration_ms,
  avg(Duration) / 1e6 AS avg_duration_ms,
  sumIf(Duration, StatusCode = 'ERROR') / 1e6 AS error_duration_ms
FROM otel_traces
WHERE SpanName LIKE 'crawl.%'
GROUP BY bucket, ServiceName, SpanName
ORDER BY bucket DESC;
