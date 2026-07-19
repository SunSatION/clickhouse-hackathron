-- Clean up OTEL tables that were incorrectly created in the `flights` database
-- by migrations 0007 and 0008. All OTEL data now lives in the `otel` database (0010).

DROP TABLE IF EXISTS flights.otel_logs;
DROP TABLE IF EXISTS flights.otel_traces;
DROP TABLE IF EXISTS flights.otel_metrics_gauge;
DROP TABLE IF EXISTS flights.otel_metrics_sum;
DROP TABLE IF EXISTS flights.otel_metrics_histogram;
DROP TABLE IF EXISTS flights.otel_metrics_summary;
DROP TABLE IF EXISTS flights.otel_metrics_exponential_histogram;
DROP VIEW IF EXISTS flights.v_crawl_otel_summary;
