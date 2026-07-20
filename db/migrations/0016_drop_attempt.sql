-- Migration 0016: Drop `attempt` from crawl_progress.
--
-- Why: `attempt` was introduced in 0012 as the per-row retry counter used by the
-- `crawl_progress_latest` view to pick the most recent row for each key via
-- `argMax(value, attempt)`. In practice every terminal write hardcoded
-- `attempt = 2` (see review issues C2/L6), making the column both
-- semantically wrong and not self-consistent with the actual write order.
--
-- Replacement: use `inserted_at` (a DateTime set on every INSERT, never
-- mutated in place) as the monotonic per-key discriminator. The view and
-- projection switch to `argMax(value, inserted_at)` and the claim/mark code
-- no longer has to look up `max(attempt) + 1` before each write.
--
-- Migration strategy (follows AGENTS.md Decision #7 — never drop a table
-- without migrating data first):
--   1. Create new table with the same schema minus `attempt`, no projection
--   2. INSERT SELECT all rows (dropping the attempt column)
--   3. Atomic RENAME swap
--   4. DROP the old table
--   5. Recreate the projection with `inserted_at` discriminator
--   6. Recreate the view with `inserted_at` discriminator

-- Step 1: new table (no attempt, no projection)
CREATE TABLE IF NOT EXISTS crawl_progress_v2
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

-- Step 2: copy rows (drop the attempt column)
INSERT INTO crawl_progress_v2
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
  FROM crawl_progress;

-- Step 3: atomic swap (split into two renames — CH Cloud Shared mode
-- disallows multi-table RENAME in one statement).
RENAME TABLE crawl_progress TO crawl_progress_old;
RENAME TABLE crawl_progress_v2 TO crawl_progress;

-- Step 4: drop the old physical table
DROP TABLE crawl_progress_old;

-- Step 5: replace the projection (uses inserted_at instead of attempt)
ALTER TABLE crawl_progress DROP PROJECTION IF EXISTS cp_latest_proj;

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

-- Step 6: recreate the view (uses inserted_at instead of attempt)
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
