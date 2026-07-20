-- Migration 0015: Add crawl_progress_latest view
--
-- Uses JOIN between a subquery computing max(attempt) per key and the base
-- table to retrieve full rows at max attempt. This avoids ClickHouse's
-- "aggregate inside aggregate" error when both the subquery and the
-- projection define max/argMax over the same key.
--
-- updated_at: uses argMax(updated_at, attempt) — returns the updated_at
-- of the row with the highest attempt. With the claim UPDATE now guarded
-- by status != 'completed'/'failed', completed rows are no longer
-- mutated and their updated_at correctly reflects completed_at.

CREATE OR REPLACE VIEW crawl_progress_latest AS
SELECT
  cp.airline,
  cp.origin_iata,
  cp.destination_iata,
  cp.date_from,
  cp.date_to,
  argMax(cp.status, cp.attempt)        AS status,
  argMax(cp.crawl_run_id, cp.attempt) AS crawl_run_id,
  argMax(cp.rows_inserted, cp.attempt) AS rows_inserted,
  argMax(cp.error_message, cp.attempt) AS error_message,
  argMax(cp.started_at, cp.attempt)   AS started_at,
  argMax(cp.completed_at, cp.attempt) AS completed_at,
  m.max_attempt                         AS attempt,
  argMax(cp.inserted_at, cp.attempt)   AS inserted_at,
  argMax(cp.updated_at, cp.attempt)     AS updated_at
FROM crawl_progress AS cp
INNER JOIN (
  SELECT
    airline,
    origin_iata,
    destination_iata,
    date_from,
    date_to,
    max(attempt) AS max_attempt
  FROM crawl_progress
  GROUP BY
    airline,
    origin_iata,
    destination_iata,
    date_from,
    date_to
) AS m
  ON  cp.airline = m.airline
  AND cp.origin_iata = m.origin_iata
  AND cp.destination_iata = m.destination_iata
  AND cp.date_from = m.date_from
  AND cp.date_to = m.date_to
  AND cp.attempt = m.max_attempt
GROUP BY
  cp.airline,
  cp.origin_iata,
  cp.destination_iata,
  cp.date_from,
  cp.date_to,
  m.max_attempt;
