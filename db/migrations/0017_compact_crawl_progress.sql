-- Migration 0017: Compact crawl_progress to only its latest row per key.
--
-- Why: the append-only pattern (Decision #5) lets stale rows accumulate when a
-- destination transitions pending -> processing -> completed (or is requeued).
-- The `crawl_progress_latest` view collapses by argMax(value, inserted_at),
-- so semantically the stale rows are invisible to reads. They still consume
-- storage and partition slots though, and any direct read of the base table
-- (audits, debug) sees ghost "pending" / "processing" rows.
--
-- Strategy: same rename-swap pattern as 0016 (per AGENTS.md Decision #7).
--   1. Build a fresh table `crawl_progress_compact` from `crawl_progress_latest`
--      (the view already returns the latest row per key).
--   2. Atomic RENAME: original table becomes `_old`, new becomes `crawl_progress`.
--   3. Drop the old table.
--   4. Recreate the projection on the new base table.
--   5. Recreate the view (idempotent — view references the name, which is now
--      the compacted table).
--
-- Safety: RENAME TABLE is atomic in ClickHouse. The active fan-out's
-- `markDestinationCompleted` writes to `crawl_progress` via INSERT, so any
-- in-flight write during the swap may briefly fail (the name swap is instant,
-- but the new table does not yet exist when the RENAME begins). The fan-out
-- task's `queue: { concurrencyLimit: 1 }` and `retry: { maxAttempts: 1 }`
-- guarantee at most one writer at a time; a transient failure surfaces as a
-- single retry. Prefer to apply this when the worker is idle.

-- Step 1: fresh empty table with the same schema
CREATE TABLE IF NOT EXISTS crawl_progress_compact
(
  `airline`          LowCardinality(String),
  `origin_iata`      LowCardinality(String),
  `destination_iata` LowCardinality(String),
  `date_from`        Date,
  `date_to`          Date,
  `status`           LowCardinality(String),
  `crawl_run_id`     String DEFAULT '',
  `rows_inserted`    UInt32 DEFAULT 0,
  `error_message`    String DEFAULT '',
  `started_at`       DateTime DEFAULT now(),
  `completed_at`     DateTime DEFAULT now(),
  `inserted_at`      DateTime DEFAULT now(),
  `updated_at`       DateTime DEFAULT now()
)
ENGINE = MergeTree
ORDER BY (airline, origin_iata, destination_iata, date_from, date_to)
PARTITION BY toYYYYMM(date_from);

-- Step 2: copy only the latest row per key (view already collapses)
INSERT INTO crawl_progress_compact
  SELECT
    airline,
    origin_iata,
    destination_iata,
    date_from,
    date_to,
    status,
    crawl_run_id,
    rows_inserted,
    error_message,
    started_at,
    completed_at,
    inserted_at,
    updated_at
  FROM crawl_progress_latest;

-- Step 3: atomic swap (split into two renames — CH Cloud Shared mode
-- disallows multi-table RENAME in one statement).
RENAME TABLE crawl_progress TO crawl_progress_old;
RENAME TABLE crawl_progress_compact TO crawl_progress;

-- Step 4: drop the original table
DROP TABLE crawl_progress_old;

-- Step 5: recreate the projection (lives on the table itself, dropped with it)
ALTER TABLE crawl_progress
  ADD PROJECTION IF NOT EXISTS cp_latest_proj
  (
    SELECT
      airline,
      origin_iata,
      destination_iata,
      date_from,
      date_to,
      argMax(status, inserted_at)        AS status_latest,
      argMax(crawl_run_id, inserted_at)  AS crawl_run_id_latest,
      argMax(rows_inserted, inserted_at) AS rows_inserted_latest,
      argMax(error_message, inserted_at) AS error_message_latest,
      argMax(started_at, inserted_at)    AS started_at_latest,
      argMax(completed_at, inserted_at)  AS completed_at_latest,
      argMax(updated_at, inserted_at)    AS updated_at_latest
    GROUP BY
      airline,
      origin_iata,
      destination_iata,
      date_from,
      date_to
  );

-- Step 6: re-create the view (idempotent; references `crawl_progress` by name)
CREATE OR REPLACE VIEW crawl_progress_latest AS
SELECT
  cp.airline,
  cp.origin_iata,
  cp.destination_iata,
  cp.date_from,
  cp.date_to,
  argMax(cp.status, cp.inserted_at)        AS status,
  argMax(cp.crawl_run_id, cp.inserted_at)  AS crawl_run_id,
  argMax(cp.rows_inserted, cp.inserted_at) AS rows_inserted,
  argMax(cp.error_message, cp.inserted_at) AS error_message,
  argMax(cp.started_at, cp.inserted_at)    AS started_at,
  argMax(cp.completed_at, cp.inserted_at)  AS completed_at,
  m.max_inserted_at                        AS inserted_at,
  argMax(cp.updated_at, cp.inserted_at)    AS updated_at
FROM crawl_progress AS cp
INNER JOIN (
  SELECT
    airline,
    origin_iata,
    destination_iata,
    date_from,
    date_to,
    max(inserted_at) AS max_inserted_at
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
  AND cp.inserted_at = m.max_inserted_at
GROUP BY
  cp.airline,
  cp.origin_iata,
  cp.destination_iata,
  cp.date_from,
  cp.date_to,
  m.max_inserted_at;