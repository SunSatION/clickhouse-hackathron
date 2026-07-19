-- Migration 0018: Stop filling started_at / completed_at with now() on insert.
--
-- Why: the table schema declared both columns with `DEFAULT now()`, so any
-- INSERT that omitted them (most notably enqueuePendingRoutes in
-- src/db/crawl-progress.ts:62-93, which seeds fresh pending rows) silently
-- got `started_at ≈ completed_at ≈ enqueue time`. Every pending row therefore
-- looked like it had been started and completed the moment it was queued,
-- which corrupted the UI's "is this row actually in flight?" signal.
--
-- After this migration:
--   * Fresh INSERTs that omit these columns get the DateTime zero value
--     (1970-01-01 00:00:00 UTC) instead of now().
--   * Existing rows are not rewritten; their already-stored values persist.
--   * Every terminal write path (markProgressCompleted, markProgressFailed,
--     claimNextPendingItem, claimSpecificPendingItem, requeueDestinations)
--     sets started_at / completed_at explicitly, so non-pending rows are
--     unaffected.
--   * The crawl_progress_latest view (0017) does argMax over these columns
--     and is unaffected.
--
-- UI contract: treat 1970-01-01 (or any sentinel-zero DateTime) as
-- "not started yet" / "not finished yet".

ALTER TABLE crawl_progress
  MODIFY COLUMN started_at DateTime DEFAULT toDateTime(0);

ALTER TABLE crawl_progress
  MODIFY COLUMN completed_at DateTime DEFAULT toDateTime(0);