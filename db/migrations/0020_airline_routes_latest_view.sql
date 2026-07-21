-- Migration 0020: Add airline_routes_latest view
--
-- Uses argMax to retrieve the latest row per route key since
-- ReplacingMergeTree's FINAL keyword is not supported in ClickHouse Cloud.
--
-- The base table uses ReplacingMergeTree(fetched_at) so older duplicates
-- are dropped on merge. This view guarantees deduplication without FINAL.

CREATE OR REPLACE VIEW airline_routes_latest AS
SELECT
  ar.airline_code,
  ar.origin_iata,
  ar.destination_iata,
  argMax(ar.destination_name, ar.fetched_at) AS destination_name,
  argMax(ar.base, ar.fetched_at) AS base,
  max(ar.fetched_at) AS fetched_at,
  argMax(ar.updated_at, ar.fetched_at) AS updated_at
FROM airline_routes AS ar
GROUP BY ar.airline_code, ar.origin_iata, ar.destination_iata;
