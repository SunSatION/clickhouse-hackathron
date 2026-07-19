-- All OTEL observability tables in the dedicated `otel` database.
-- This moves the schema from 0007 and 0008 into the otel database.
-- HyperDX ClickStack points at this database via HYPERDX_OTEL_EXPORTER_CLICKHOUSE_DATABASE=otel.

-- otel_logs must exist before otel_traces can be created (no FK, but logical ordering)
CREATE TABLE IF NOT EXISTS otel.otel_logs
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
  INDEX idx_lower_body lower(Body) TYPE text(tokenizer = 'splitByNonAlpha'),
  `updated_at` DateTime DEFAULT now()
)
ENGINE = MergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (toStartOfFiveMinutes(Timestamp), ServiceName, Timestamp)
TTL toDateTime(Timestamp) + INTERVAL 30 DAY
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

CREATE TABLE IF NOT EXISTS otel.otel_traces
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
  INDEX idx_duration Duration TYPE minmax GRANULARITY 1,
  `updated_at` DateTime DEFAULT now()
)
ENGINE = MergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (ServiceName, SpanName, toDateTime(Timestamp))
TTL toDateTime(Timestamp) + INTERVAL 30 DAY
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

CREATE TABLE IF NOT EXISTS otel.otel_metrics_gauge
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
  INDEX idx_time_minmax TimeUnix TYPE minmax GRANULARITY 1,
  `updated_at` DateTime DEFAULT now()
)
ENGINE = MergeTree
PARTITION BY toDate(TimeUnix)
ORDER BY (ServiceName, MetricName, toStartOfHour(TimeUnix), cityHash64(Attributes), TimeUnix)
TTL toDateTime(TimeUnix) + INTERVAL 30 DAY
SETTINGS ttl_only_drop_parts = 1;

CREATE TABLE IF NOT EXISTS otel.otel_metrics_sum
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
  INDEX idx_time_minmax TimeUnix TYPE minmax GRANULARITY 1,
  `updated_at` DateTime DEFAULT now()
)
ENGINE = MergeTree
PARTITION BY toDate(TimeUnix)
ORDER BY (ServiceName, MetricName, toStartOfHour(TimeUnix), cityHash64(Attributes), TimeUnix)
TTL toDateTime(TimeUnix) + INTERVAL 30 DAY
SETTINGS ttl_only_drop_parts = 1;

CREATE TABLE IF NOT EXISTS otel.otel_metrics_histogram
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
  INDEX idx_time_minmax TimeUnix TYPE minmax GRANULARITY 1,
  `updated_at` DateTime DEFAULT now()
)
ENGINE = MergeTree
PARTITION BY toDate(TimeUnix)
ORDER BY (ServiceName, MetricName, toStartOfHour(TimeUnix), cityHash64(Attributes), TimeUnix)
TTL toDateTime(TimeUnix) + INTERVAL 30 DAY
SETTINGS ttl_only_drop_parts = 1;

CREATE TABLE IF NOT EXISTS otel.otel_metrics_summary
(
    `ResourceAttributes` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    `ResourceSchemaUrl` String CODEC(ZSTD(1)),
    `ScopeName` String CODEC(ZSTD(1)),
    `ScopeVersion` String CODEC(ZSTD(1)),
    `ScopeAttributes` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    `ScopeDroppedAttrCount` UInt32 CODEC(ZSTD(1)),
    `ServiceName` LowCardinality(String) CODEC(ZSTD(1)),
    `MetricName` LowCardinality(String) CODEC(ZSTD(1)),
    `MetricDescription` String CODEC(ZSTD(1)),
    `MetricUnit` String CODEC(ZSTD(1)),
    `Attributes` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    `StartTimeUnix` DateTime CODEC(Delta, ZSTD(1)),
    `TimeUnix` DateTime CODEC(Delta, ZSTD(1)),
    `Count` UInt64 CODEC(Delta(8), ZSTD(1)),
    `Sum` Float64 CODEC(ZSTD(1)),
    `ValueAtQuantiles.Quantile` Array(Float64) CODEC(ZSTD(1)),
    `ValueAtQuantiles.Value` Array(Float64) CODEC(ZSTD(1)),
    `Flags` UInt32 CODEC(ZSTD(1)),
    `updated_at` DateTime DEFAULT now()
)
ENGINE = MergeTree
PARTITION BY toDate(TimeUnix)
ORDER BY (ServiceName, MetricName, toStartOfHour(TimeUnix), cityHash64(Attributes), TimeUnix)
TTL toDateTime(TimeUnix) + INTERVAL 30 DAY
SETTINGS ttl_only_drop_parts = 1;

CREATE TABLE IF NOT EXISTS otel.otel_metrics_exponential_histogram
(
    `ResourceAttributes` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    `ResourceSchemaUrl` String CODEC(ZSTD(1)),
    `ScopeName` String CODEC(ZSTD(1)),
    `ScopeVersion` String CODEC(ZSTD(1)),
    `ScopeAttributes` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    `ScopeDroppedAttrCount` UInt32 CODEC(ZSTD(1)),
    `ServiceName` LowCardinality(String) CODEC(ZSTD(1)),
    `MetricName` LowCardinality(String) CODEC(ZSTD(1)),
    `MetricDescription` String CODEC(ZSTD(1)),
    `MetricUnit` String CODEC(ZSTD(1)),
    `Attributes` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    `StartTimeUnix` DateTime CODEC(Delta, ZSTD(1)),
    `TimeUnix` DateTime CODEC(Delta, ZSTD(1)),
    `Count` UInt64 CODEC(Delta(8), ZSTD(1)),
    `Sum` Float64 CODEC(ZSTD(1)),
    `Scale` Int32 CODEC(ZSTD(1)),
    `ZeroCount` UInt64 CODEC(ZSTD(1)),
    `PositiveOffset` Int32 CODEC(ZSTD(1)),
    `PositiveBucketCounts` Array(UInt64) CODEC(ZSTD(1)),
    `NegativeOffset` Int32 CODEC(ZSTD(1)),
    `NegativeBucketCounts` Array(UInt64) CODEC(ZSTD(1)),
    `Flags` UInt32 CODEC(ZSTD(1)),
    `Min` Float64 CODEC(ZSTD(1)),
    `Max` Float64 CODEC(ZSTD(1)),
    `AggregationTemporality` Int32 CODEC(ZSTD(1)),
    `updated_at` DateTime DEFAULT now()
)
ENGINE = MergeTree
PARTITION BY toDate(TimeUnix)
ORDER BY (ServiceName, MetricName, toStartOfHour(TimeUnix), cityHash64(Attributes), TimeUnix)
TTL toDateTime(TimeUnix) + INTERVAL 30 DAY
SETTINGS ttl_only_drop_parts = 1;
