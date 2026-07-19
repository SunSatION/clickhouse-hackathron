-- Migration 0014: Add argMax projection to crawl_progress
--
-- Problem: Migration 0012 switched crawl_progress to MergeTree (append-only log).
-- Each attempt creates a new physical row; queries without FINAL get stale rows.
--
-- Solution: Add a ClickHouse projection that pre-computes argMax(status, attempt)
-- per key. ClickHouse evaluates it automatically during merges.
--
-- Usage:
--   SELECT * FROM crawl_progress GROUP BY airline, origin_iata, destination_iata,
--          date_from, date_to HAVING attempt = max(attempt)
--
-- ClickHouse automatically uses the projection for the above query.
-- A companion view (crawl_progress_latest) is created separately in 0015.

ALTER TABLE crawl_progress
  ADD PROJECTION IF NOT EXISTS cp_latest_proj
  (
    SELECT
      airline,
      origin_iata,
      destination_iata,
      date_from,
      date_to,
      argMax(status, attempt)        AS status_latest,
      argMax(crawl_run_id, attempt)  AS crawl_run_id_latest,
      argMax(rows_inserted, attempt) AS rows_inserted_latest,
      argMax(error_message, attempt) AS error_message_latest,
      argMax(started_at, attempt)    AS started_at_latest,
      argMax(completed_at, attempt)  AS completed_at_latest,
      argMax(inserted_at, attempt)  AS inserted_at_latest,
      argMax(updated_at, attempt)    AS updated_at_latest
    GROUP BY
      airline,
      origin_iata,
      destination_iata,
      date_from,
      date_to
  );
