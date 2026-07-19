-- Migration 0013: add `updated_at` column to every project-owned table.
--
-- The column uses `DEFAULT now()` so:
--   - Every INSERT populates it with the current time automatically (no app changes).
--   - Existing rows receive the ALTER-time value (acceptable; they get refreshed on the
--     next INSERT that collapses them via ReplacingMergeTree, or on the next UPDATE).
--
-- Tables covered:
--   flights database: flight_listings, ryanair_listings, easyjet_listings,
--                     airline_routes, airline_routes_backup, crawl_progress
--   otel database:    otel_logs, otel_traces, otel_metrics_{gauge,sum,histogram,
--                     summary,exponential_histogram}
--
-- Views and materialized views are intentionally skipped — they have no storage
-- schema of their own. MVs inherit the new column on the source table for the
-- `flight_listings_*_mv` fan-out (the target `flight_listings` gets the column
-- and DEFAULT applies to all inserts, including those routed through the MV).

ALTER TABLE flight_listings             ADD COLUMN IF NOT EXISTS updated_at DateTime DEFAULT now();
ALTER TABLE ryanair_listings            ADD COLUMN IF NOT EXISTS updated_at DateTime DEFAULT now();
ALTER TABLE easyjet_listings            ADD COLUMN IF NOT EXISTS updated_at DateTime DEFAULT now();
ALTER TABLE airline_routes              ADD COLUMN IF NOT EXISTS updated_at DateTime DEFAULT now();
ALTER TABLE airline_routes_backup       ADD COLUMN IF NOT EXISTS updated_at DateTime DEFAULT now();
ALTER TABLE crawl_progress              ADD COLUMN IF NOT EXISTS updated_at DateTime DEFAULT now();

ALTER TABLE otel.otel_logs                          ADD COLUMN IF NOT EXISTS updated_at DateTime DEFAULT now();
ALTER TABLE otel.otel_traces                        ADD COLUMN IF NOT EXISTS updated_at DateTime DEFAULT now();
ALTER TABLE otel.otel_metrics_gauge                 ADD COLUMN IF NOT EXISTS updated_at DateTime DEFAULT now();
ALTER TABLE otel.otel_metrics_sum                   ADD COLUMN IF NOT EXISTS updated_at DateTime DEFAULT now();
ALTER TABLE otel.otel_metrics_histogram             ADD COLUMN IF NOT EXISTS updated_at DateTime DEFAULT now();
ALTER TABLE otel.otel_metrics_summary               ADD COLUMN IF NOT EXISTS updated_at DateTime DEFAULT now();
ALTER TABLE otel.otel_metrics_exponential_histogram ADD COLUMN IF NOT EXISTS updated_at DateTime DEFAULT now();
