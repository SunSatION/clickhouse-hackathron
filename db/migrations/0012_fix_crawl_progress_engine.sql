-- Migration 0012: Fix crawl_progress table.
--
-- OLD (0006): ReplacingMergeTree(completed_at) — collapses all attempts into one row,
--             making retries and history invisible. Also lacked "pending" status.
--
-- NEW: MergeTree — every attempt is a distinct row. Adds:
--   - status: "pending" | "processing" | "completed" | "failed"
--   - attempt: UInt32 (resets per (airline, origin, destination, date_range) work item)
--   - inserted_at: when the work item was first enqueued
--
-- Work queue pattern:
--   1. Seed: INSERT all route combos as status='pending', attempt=1
--   2. Worker: UPDATE status='processing' WHERE status='pending' ORDER BY inserted_at LIMIT 1
--   3. Worker: on success INSERT new row status='completed'; on failure INSERT new row status='failed'
--      (always insert new rows — never UPDATE in place, so each attempt is tracked)

-- Step 1: create new table
CREATE TABLE IF NOT EXISTS crawl_progress_new
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
  `attempt`          UInt32 DEFAULT 1,
  `inserted_at`      DateTime DEFAULT now(),
  `updated_at`       DateTime DEFAULT now()
)
ENGINE = MergeTree
ORDER BY (airline, origin_iata, destination_iata, date_from, date_to, attempt)
PARTITION BY toYYYYMM(date_from);

-- Step 2: copy existing rows from old table
-- completed/failed rows get attempt=1; pending (if any) also attempt=1
INSERT INTO crawl_progress_new
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
    1 AS attempt,
    now() AS inserted_at
  FROM crawl_progress;

-- Step 3: swap old and new tables atomically
RENAME TABLE crawl_progress TO crawl_progress_old, crawl_progress_new TO crawl_progress;

-- Step 4: clean up old table
DROP TABLE crawl_progress_old;
