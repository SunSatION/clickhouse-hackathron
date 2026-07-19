/**
 * Human-readable descriptions for every Trigger.dev task defined in this
 * project. Kept in one file so the backend tasks and the dummy frontend
 * agree on the wording without duplicating strings.
 *
 * Keys are the task `id` strings used in `schemaTask({ id: ... })`.
 */
export const TASK_DESCRIPTIONS = {
  "sync-ryanair-routes": {
    label: "Sync Ryanair routes",
    summary:
      "Fetches the full Ryanair active-airports catalogue and, for each origin, calls the per-airport routes endpoint. Persists the result to the airline_routes table so the crawlers know which destinations to scan.",
    params: ["concurrency (1–20, default 1)"],
    eta: "~5.5 min for 224 origins at concurrency=1",
  },
  "crawl-ryanair-range-route": {
    label: "[LEGACY] Crawl one Ryanair origin (range, FARFND monthly)",
    summary:
      "LEGACY path (no longer triggered from the frontend): calls Ryanair's FARFND cheapestPerDay endpoint once per destination for the given origin and date range — one HTTP request covers every day in the outbound month (outboundMonthOfDate=dateFrom), so a 30-day window is 1 call per destination, not 30. Writes completed/failed rows to crawl_progress directly. Prefer crawl-queue-worker (fronted by /api/trigger/full-scan or /api/trigger/single-origin) which goes through the proper pending → processing → completed/failed queue lifecycle.",
    params: ["originIata", "dateFrom", "dateTo", "adults", "requestDelayMs"],
    eta: "~25s per destination at default rate (1 call each)",
  },
  "crawl-ryanair-range": {
    label: "[LEGACY] Full Ryanair scan (range, FARFND monthly)",
    summary:
      "LEGACY fan-out (no longer triggered from the frontend): batches crawl-ryanair-range-route across the supplied origins. Writes completed/failed rows to crawl_progress directly with no pending state, so the dashboard shows nothing until each destination finishes. Prefer crawl-queue-worker (fronted by /api/trigger/full-scan or /api/trigger/single-origin) which seeds the queue first so you can see what's pending, skip items, or re-prioritise.",
    params: ["origins[]", "dateFrom", "dateTo", "destinationFilter?"],
    eta: "~25s per (origin, destination) at default rate — e.g. 9 origins × ~93 destinations ≈ 5.8 h",
  },
  "crawl-ryanair-route": {
    label: "Crawl one Ryanair origin (legacy per-date)",
    summary:
      "Legacy crawler: one booking availability call per (origin, destination, date) pair. Slower than the range crawler — prefer crawl-ryanair-range-route for new work.",
    params: ["originIata", "dateFrom", "dateTo"],
    eta: "~25s per (destination, date) pair",
  },
  "crawl-ryanair": {
    label: "Crawl Ryanair (legacy fan-out)",
    summary:
      "Legacy fan-out wrapper around crawl-ryanair-route. Same destination-by-destination approach as the range crawler but emits one HTTP call per date in the window.",
    params: ["origins[]", "dateFrom", "dateTo"],
    eta: "O(dateFrom..dateTo × destinations × 25s)",
  },
  "crawl-easyjet-route": {
    label: "Crawl one EasyJet origin",
    summary:
      "Calls the EasyJet availability API once per destination for the given origin and date range. Same resume/mark-completed behaviour as the Ryanair range crawler.",
    params: ["originIata", "destinations[]", "dateFrom", "dateTo"],
    eta: "~25s per destination at default rate",
  },
  "crawl-easyjet": {
    label: "Crawl EasyJet (fan-out)",
    summary:
      "Fan-out wrapper that batches crawl-easyjet-route across multiple origins.",
    params: ["origins[]", "dateFrom", "dateTo"],
    eta: "Depends on origin count and destination list",
  },
  "crawl-airlines": {
    label: "Crawl all airlines",
    summary:
      "Top-level entry point that fan-outs to per-airline crawlers (Ryanair for now). Designed for the periodic scheduler.",
    params: ["airlines[]", "origins by code", "dateFrom", "dateTo"],
    eta: "Driven by the underlying per-airline crawler ETAs",
  },
  "seed-crawl-queue": {
    label: "Seed crawl queue",
    summary:
      "Reads airline_routes and inserts one pending work item per (origin, destination, date range). Workers claim and process destination rows sequentially.",
    params: ["airline", "origins[]", "dateFrom", "dateTo"],
    eta: "Seconds (DB insert only)",
  },
  "crawl-queue-worker": {
    label: "Crawl queue worker (FARFND monthly)",
    summary:
      "Claims the next pending queue item, calls the Ryanair range crawler (FARFND cheapestPerDay — 1 HTTP call per (origin, destination) covering the whole month) for that origin, then marks it completed or failed. Auto-reclaims stale items after 30 min. Loops up to maxIterations per run.",
    params: ["airline", "crawlRunId", "maxIterations"],
    eta: "~25s per (origin, destination) (one at a time)",
  },
  "crawl-pending-item": {
    label: "Crawl one pending item (FARFND monthly)",
    summary:
      "Claims a specific crawl_progress row (airline, origin, destination, date_from, date_to) — picked by the operator from the frontend queue — runs the Ryanair range crawler (FARFND cheapestPerDay — 1 HTTP call per destination covering the whole month) for that one destination, and marks the row completed or failed. Use this to retry or selectively drain individual items without firing the full queue worker. Pass force=true to steal a row that's currently in 'processing' (e.g. grabbed by the queue worker).",
    params: ["airline", "originIata", "destinationIata", "dateFrom", "dateTo", "force?"],
    eta: "~25s per destination at default rate (1 FARFND call)",
  },
  "crawl-airlines-six-hours": {
    label: "Scheduled: crawl all airlines (every 6h)",
    summary:
      "Cron schedule (0 */6 * * *) that triggers crawl-airlines with RYANAIR_ORIGINS from env. Used by the production scheduler.",
    params: ["cron-managed"],
    eta: "n/a",
  },
} as const;

export type TaskId = keyof typeof TASK_DESCRIPTIONS;

export function listTaskDescriptions(): Array<{
  id: TaskId;
  label: string;
  summary: string;
  params: readonly string[];
  eta: string;
}> {
  return (Object.entries(TASK_DESCRIPTIONS) as Array<[TaskId, (typeof TASK_DESCRIPTIONS)[TaskId]]>).map(
    ([id, v]) => ({ id, ...v })
  );
}