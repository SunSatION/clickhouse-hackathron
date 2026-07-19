-- Create dedicated OTEL observability database.
-- HyperDX ClickStack reads from this database via HYPERDX_OTEL_EXPORTER_CLICKHOUSE_DATABASE.
CREATE DATABASE IF NOT EXISTS otel;
