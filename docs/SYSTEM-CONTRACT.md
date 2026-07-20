# Hackathron — System Contract (agent reference)

This document is the canonical reference for the agent that owns this
repo. It records **what the working system looks like today** and which
invariants must be preserved when making changes. Update it whenever an
explicitly approved architecture change ships.

> Read it before touching: Trigger.dev task IDs/payloads, ClickHouse
> schemas, the `crawl_progress` queue, crawl pacing, or the OTel pipeline.

## 1. High-level architecture

```
+------------------+    tasks.trigger(...)    +-------------------------+
|  Express server  |  -------------------------> |  Trigger.dev cloud       |
|  src/frontend/   |                            |  (proj_owjhucduaoxtjdadhkad)|
+------------------+                            +-------------------------+
                                                       |
                                                       v
                          +----------------------------+----------------------------+
                          |                            |                            |
              +-----------v----------+      +----------v-----------+     +-----------v---------+
              |  Crawler tasks        |      |  Queue worker tasks |     |  Sync / admin tasks |
              |  crawl-ryanair-range* |      |  crawl-queue-worker |     |  sync-ryanair-routes|
              |  crawl-pending-item   |      |  seed-crawl-queue   |     |                     |
              +-----------+-----------+      +----------+-----------+     +-----------+---------+
                          |                           |                              |
                          v                           v                              v
                  +-------+-----------------------+---+----------------------+----------+
                  |       Ryanair / EasyJet crawler modules (src/airlines/*.ts)          |
                  |  Paced fetch via *PacedFetch wrappers + global Pacer                |
                  +-------------------------------+--------------------------------------+
                                                  |
                                                  v
+--------------------------+         +-----------------------------+
|   flights (ClickHouse)   | <-----  |  OTel emitters              |
|  flight_listings + MVs   |         |  src/observability/*        |
|  ryanair_listings        |         |  direct INSERT into         |
|  easyjet_listings        |         |  ClickStack tables in `otel`|
|  airline_routes          |         |  database                   |
|  crawl_progress          |         +-----------------------------+
|  crawl_progress_latest   |
+--------------------------+
```

Trigger.dev orchestrates the work; ClickHouse stores both the data and
the OTel signal; a thin Express server (`src/frontend/server.ts`) is the
operator UI and the only entry point for HTTP-triggered tasks.

## 2. Trigger.dev project surface

- Project ref: `proj_owjhucduaoxtjdadhkad` (`trigger.config.ts:4`).
- Task discovery root: `src/trigger/` (`trigger.config.ts:21`).
- All tasks import from `@trigger.dev/sdk` only — never
  `@trigger.dev/sdk/v3` (deprecated alias).
- All tasks are `schemaTask` (or `schedules.task` for the cron) and MUST
  call `installFetchInstrumentation()` at module load so the global
  fetch pacing and OTel fetch spans are installed before any work.
- Every task that calls `configureOtel(...)` registers an OTel resource
  with `service.name = "hackathron-crawler"` and an `app.component`
  attribute equal to the file stem.

### 2.1 Stable task IDs (do not rename)

| ID                                | Kind            | File                                   | Notes |
|-----------------------------------|-----------------|----------------------------------------|-------|
| `sync-ryanair-routes`             | `schemaTask`    | `src/trigger/sync-ryanair-routes.ts`   | Catalogue + per-airport routes sync. |
| `crawl-ryanair-range-route`       | `schemaTask`    | `src/trigger/crawl-ryanair-range.ts`   | One origin, FARFND `cheapestPerDay`. |
| `crawl-ryanair-range`             | `schemaTask`    | `src/trigger/crawl-ryanair-range.ts`   | Fan-out across `origins[]`. |
| `crawl-airlines`                  | `schemaTask`    | `src/trigger/crawl-airlines.ts`        | Top-level airline fan-out (currently Ryanair only). |
| `crawl-airlines-six-hours`        | `schedules.task`| `src/trigger/crawl-airlines.ts`        | Cron `0 */6 * * *` → triggers `crawl-airlines`. |
| `crawl-pending-item`              | `schemaTask`    | `src/trigger/crawl-pending-item.ts`    | Per-destination retry/steal; honours `force`. |
| `seed-crawl-queue`                | `schemaTask`    | `src/trigger/seed-crawl-queue.ts`      | Seeds `crawl_progress` from `airline_routes`. |
| `crawl-queue-worker`              | `schemaTask`    | `src/trigger/crawl-queue-worker.ts`    | Loops `claimNextPendingItem` → crawl → mark. |
| `crawl-ryanair-route`             | `schemaTask`    | `src/trigger/crawl-ryanair.ts`         | Legacy per-date availability (kept for back-compat). |
| `crawl-ryanair`                   | `schemaTask`    | `src/trigger/crawl-ryanair.ts`         | Legacy fan-out. |
| `crawl-easyjet-route`             | `schemaTask`    | `src/trigger/crawl-easyjet.ts`         | EasyJet per-origin (operator surface only). |
| `crawl-easyjet`                   | `schemaTask`    | `src/trigger/crawl-easyjet.ts`         | EasyJet fan-out. |

Any caller of these IDs goes through `tasks.trigger<typeof X>("id", payload)`
in `src/frontend/server.ts`. Renaming a task ID is a breaking change —
the dashboard, in-flight runs, schedules and external links all break.

### 2.2 Required task properties

- `queue: { concurrencyLimit: 1 }` on every `schemaTask` (including
  the `crawl-airlines` and the cron driver). This guarantees the
  global request rate is governed by the Pacer rather than parallel
  invocations.
- `installFetchInstrumentation()` is the second top-level call after
  `configureOtel(...)` so the global fetch patch is in place before any
  airline fetch can run.
- All payloads validate against Zod via `schemaTask({ schema: ... })`
  using the shared primitives from `src/trigger/schemas.ts`:
  - `IATA` — 3 uppercase letters.
  - `DateStr` — `YYYY-MM-DD`.
  - `RequestDelayMs` — `0..60_000` (single source of truth for the cap).
  - `RequestJitterMs` — `0..30_000`.
- `concurrency` (where supported) is clamped to `1..20` server-side.
- `crawlRunId` is always a UUID and is the seed for the OTel TraceId
  via `newTraceId(crawlRunId)` (`src/observability/ids.ts`).
- **`ttl` (time-to-live) MUST be set explicitly** on every task that
  fans out long-running children (notably `crawl-ryanair-range` and
  `crawl-ryanair-range-route`). Trigger.dev **development mode
  defaults to a 10-minute TTL** (`node_modules/@trigger.dev/core/.../tasks.d.ts:594`).
  At 8 s/call × 122 destinations, a single origin fan-out takes
  ~16 min — well past the dev TTL — so without `ttl: "3h"` the queued
  sibling routes EXPIRE while the first route is still running. The
  parent `crawl-ryanair-range` then completes "successfully" with most
  children `EXPIRED`, leaving the user thinking the crawl succeeded.
  Set `ttl` on the task definition (preferred) or pass it via
  `tasks.trigger(payload, { ttl: "3h" })` per-trigger.

### 2.3 Triggering patterns (do not deviate)

- `tasks.trigger<typeof TaskExport>("task-id", payload)` from
  `src/frontend/server.ts` — never `import` the task instance into the
  Express bundle.
- `task.batchTriggerAndWait([{ payload }, ...])` for fan-out — never
  wrap in `Promise.all`.
- `metadata.set/get` only inside `run()`; metadata is per-task and does
  not propagate to children. Forward via `metadata.parent.*` if needed.
- `traceTask({...}).start()` installs the active task trace context;
  calling `.finish()` / `.fail()` clears it. Always pair `.start()` with
  exactly one of `.finish()` / `.fail()` (in `finally` if needed).

## 3. ClickHouse surface

### 3.1 Connections (`src/db/clickhouse.ts`)

- `getClickHouse()` → flights database (`CLICKHOUSE_DATABASE`,
  default `flights`).
- `getClickHouseForOtel()` → OTel database (`OTEL_DATABASE`,
  default `otel`).
- Both share `CLICKHOUSE_URL` / `CLICKHOUSE_USERNAME` /
  `CLICKHOUSE_PASSWORD`; pools are limited to 10 connections with 30 s
  request timeout.

### 3.2 Migrations

- Stored in `db/migrations/*.sql` and applied by
  `src/db/migrate.ts` (idempotent, tracks applied names in
  `default._migrations`).
- Tasks call `runMigrations()` early in `run()` so the schema is
  current on cold start.
- **Never** drop or replace a table without first migrating its data
  (AGENTS.md Decision #7). Use `RENAME TABLE` or
  `INSERT INTO new SELECT * FROM old` + `DROP old`.

### 3.3 Tables and views (flights)

| Object                  | Engine                              | Purpose |
|-------------------------|-------------------------------------|---------|
| `flight_listings`       | `MergeTree` ORDER BY `(departure_date, origin_iata, destination_iata, departure_datetime)` PARTITION BY `toYYYYMM(departure_date)` TTL `+2 YEAR` | Unified listings. |
| `ryanair_listings`      | `MergeTree` (same shape)            | Ryanair staging; MV fans out into `flight_listings`. |
| `easyjet_listings`      | `MergeTree` (same shape)            | EasyJet staging. |
| `airline_routes`        | `ReplacingMergeTree(fetched_at)` ORDER BY `(airline_code, origin_iata, destination_iata)` | Per-(airline, origin) destination roster. Read with `FINAL` (`src/db/airline-routes.ts`). |
| `airline_routes_backup` | `ReplacingMergeTree(fetched_at)`    | Cold backup (5246 rows); restore via `db/backup/README_restore.sql`. |
| `crawl_progress`        | `MergeTree` ORDER BY `(airline, origin_iata, destination_iata, date_from, date_to)` PARTITION BY `toYYYYMM(date_from)` | Append-only queue log. |
| `crawl_progress_latest` | `VIEW` (joins on `max(inserted_at)` then `argMax(value, inserted_at)`) | All reads that care about current state MUST go through this view. |

### 3.4 Tables (otel)

`db/migrations/0009_create_otel_database.sql` +
`db/migrations/0010_otel_tables.sql`:

- `otel.otel_logs`
- `otel.otel_traces`
- `otel.otel_metrics_gauge`
- `otel.otel_metrics_sum`
- `otel.otel_metrics_histogram`
- `otel.otel_metrics_summary`
- `otel.otel_metrics_exponential_histogram`

All `MergeTree`, partitioned by day, 30-day TTL via
`ttl_only_drop_parts = 1`. No other database should host OTel tables.

### 3.5 `crawl_progress` invariants (read carefully)

- **Append-only**. Every state change writes a new physical row.
- Writes are always `INSERT` (never `ALTER TABLE … UPDATE/DELETE`).
  - `claimNextPendingItem` / `claimSpecificPendingItem` /
    `requeueDestinations` use
    `INSERT INTO crawl_progress SELECT … FROM crawl_progress_latest`.
  - Seed and terminal marks (`markProgressCompleted`,
    `markProgressFailed`) use direct `INSERT INTO crawl_progress`.
- The per-key discriminator is `inserted_at`. The view
  `crawl_progress_latest` returns the row with `argMax(value, inserted_at)`
  for each key. `attempt` was dropped in migration `0016_drop_attempt.sql`
  and must not be reintroduced.
- `markProgressCompleted` is **skipped** when the crawler reported
  `rowsInserted === 0` (see `src/airlines/ryanair.ts`); a zero-result
  retry must never clobber a previous successful count.
  `getCompletedDestinations` filters `rows_inserted > 0` for the same
  reason.
- A pending row must always reach `completed` or `failed`; never leave
  it dangling in `pending`/`processing`. Stale `processing` rows are
  swept to `failed` after 30 minutes by `claimNextPendingItem`.
- `claimSpecificPendingItem({ force: true })` is the only path that
  can overwrite a row in any state; everything else respects the
  current state.
- `crawl_run_id` is stamped on **every** row — including pending
  ones. `enqueuePendingRoutes({ crawlRunId })` writes the requested
  id; the dashboard queue view shows `crawl_run_id` on pending rows.
- `claimNextPendingItem` scopes its picker to
  `crawl_run_id = '' OR crawl_run_id = {crawlRunId}` so that a worker
  re-fired with `runId=X` drains **only** its own pending rows
  (plus legacy empty-id rows as a fallback). This makes resume
  scoped instead of cross-pollinating.

## 4. Airline crawler contract

- Single source of truth for rate limits: `src/config/crawl.ts`.
  Defaults (Ryanair & EasyJet): 20 s delay, 10 s jitter, 0 cooldown,
  1 adult. **Do not lower these defaults.**
- Every HTTP request is paced:
  - `installGlobalPacing()` in `src/lib/paced-fetch.ts` patches
    `globalThis.fetch` with a shared `Pacer` (default 2 s + 500 ms
    jitter, env-overridable via `GLOBAL_FETCH_DELAY_MS` /
    `GLOBAL_FETCH_JITTER_MS`).
  - `installFetchInstrumentation()` layers OTel fetch spans on top
    and is the only sanctioned entry point for fetch instrumentation.
  - `src/airlines/ryanair.ts` defines `ryanairPacer` +
    `ryanairPacedFetch`; `src/airlines/easyjet.ts` defines the
    EasyJet equivalents. **No bare `fetch()` in `src/airlines/*.ts`.**
- Ryanair auth: the booking availability API requires
  `fr-correlation-id` + `xid` cookies. `xid` expires — re-grab from
  devtools when `409 Availability declined` is returned.
- Ryanair ToU rejection is a hard error: `RyanairTermsOfUseError`
  (`src/airlines/ryanair.ts`) detects both `200 + code:TermsOfUseAreNotAccepted`
  and `409 + message:Availability declined`, attempts
  `POST /api/agree-terms` once per correlation id, and throws. The
  outer crawler loop marks the destination `failed` (not
  `completed` with `rows_inserted = 0`) and aborts the origin's fanout.
- Range crawler math: `crawlRyanairRangeForOrigin` calls the FARFND
  `cheapestPerDay` endpoint once per destination with
  `outboundMonthOfDate = dateFrom`, then filters to
  `[dateFrom, dateTo]`. A 30-day window = 1 call per destination.

## 5. Observability contract

- `OTEL_ENABLE=0` disables the in-process emitters; production
  behaviour never depends on telemetry writes (AGENTS.md Decision #1).
- `OTEL_SERVICE_NAME` defaults to `hackathron-crawler`.
- Trace ids are **always** `newTraceId(crawlRunId)`, so a single
  Trigger run shares one TraceId across all logs/spans/metrics and
  joins cleanly to `flight_listings.crawl_run_id` and
  `crawl_progress.crawl_run_id`.
- `traceTask().start()` installs an active task context (process-wide
  via `_activeTaskContext` in `src/observability/context.ts`) so
  `withSpan`, fetch instrumentation and `otelLogger` inherit the
  correct TraceId even without explicit AsyncLocalStorage plumbing.
  Trigger.dev tasks run with `concurrencyLimit: 1` so this module-level
  context is safe. `finish()` / `fail()` clear it in `finally`.
- HyperDX ClickStack must be pointed at the `otel` database:
  `HYPERDX_OTEL_EXPORTER_CLICKHOUSE_DATABASE=otel`.

## 6. Express server (`src/frontend/server.ts`)

Stable HTTP contract (frontend + operator workflows depend on these):

| Method + path                            | Behaviour |
|------------------------------------------|-----------|
| `GET  /api/health`                       | Pings both ClickHouse DBs. |
| `GET  /api/tasks`                        | Returns `listTaskDescriptions()`. |
| `GET  /api/config`                       | Returns `CRAWL_CONFIG`, RYANAIR origins, HyperDX URL. |
| `GET  /api/origins`                      | `airline_routes` per-origin destination counts. |
| `GET  /api/destinations`                 | Destinations for an origin. |
| `GET  /api/iatas`                        | All IATAs known to `airline_routes`. |
| `GET  /api/queue/stats`                  | Queue counters from `crawl_progress_latest`. |
| `GET  /api/queue/items`                  | Per-key queue rows. |
| `GET  /api/queue/items-by-run`           | Queue rows grouped by crawl run. |
| `GET  /api/runs/recent` / `/api/runs`    | Recent Trigger runs. |
| `GET  /api/runs/:runId`                  | Single run detail. |
| `GET  /api/otel/trace`                   | Lookup spans/logs by traceId. |
| `GET  /api/otel/recent-traces`           | Recent OTel trace ids. |
| `POST /api/trigger/full-scan`            | Seeds `crawl_progress` with one `pending` row per `(origin, destination, dateFrom, dateTo)` for every reachable origin in `RYANAIR_ORIGINS` (or `body.origins`), then triggers `crawl-queue-worker` with `airline='Ryanair'`. The queue worker claims one item at a time, processes it via the FARFND crawler, marks it completed/failed, and loops until the queue is drained or `maxIterations` is hit. |
| `POST /api/trigger/single-origin`        | Same as `/api/trigger/full-scan` but seeds only `body.origin` (1 origin) before triggering the worker. |
| `POST /api/trigger/seed-queue`           | Equivalent to `/api/trigger/full-scan` (kept for back-compat). |
| `POST /api/trigger/crawl-pending-item`   | Triggers `crawl-pending-item` — claims and processes a single row by `(airline, origin, destination, dateFrom, dateTo)`. Pass `force: true` to steal a row currently in `processing`. |
| `POST /api/trigger/crawl-queue-worker`   | Triggers `crawl-queue-worker` directly with `body.runId` (crawl run id, falls back to a fresh UUID). **No re-seeding.** The worker drains pending rows stamped with that id (or empty ids for legacy), processes each, and exits when no more match. Use this to resume an existing run without reseeding. |
| `POST /api/trigger/sync-ryanair-routes`  | Triggers `sync-ryanair-routes`. |

The script-spawning endpoints (`/api/scripts/*`) exist as operator
fallbacks; prefer the typed `/api/trigger/*` routes from external
clients.

**Front-end → task mapping (post-refactor):**

| Frontend endpoint | Backend tasks |
|---|---|
| `/api/trigger/full-scan` | `enqueuePendingRoutes(crawlRunId)` → `crawl-queue-worker` |
| `/api/trigger/single-origin` | `enqueuePendingRoutes(crawlRunId)` → `crawl-queue-worker` |
| `/api/trigger/seed-queue` | `enqueuePendingRoutes(crawlRunId)` → `crawl-queue-worker` |
| `/api/trigger/crawl-queue-worker` | `crawl-queue-worker` (no seed; resume only) |
| `/api/trigger/crawl-pending-item` | `crawl-pending-item` |
| `/api/trigger/sync-ryanair-routes` | `sync-ryanair-routes` |

`crawl-ryanair-range` and `crawl-ryanair-range-route` are still
deployed (Dashboard links work) but the frontend does not trigger
them — see §9.

## 7. Environment variables (names only — never embed secret values)

| Name                                              | Source / read site                                 | Purpose |
|---------------------------------------------------|----------------------------------------------------|---------|
| `CLICKHOUSE_URL`                                  | `src/db/clickhouse.ts:13, 31`                      | ClickHouse HTTP endpoint. |
| `CLICKHOUSE_DATABASE`                             | `:14`                                              | flights DB (default `default`). |
| `OTEL_DATABASE`                                   | `:32`                                              | OTel DB (default `otel`). |
| `CLICKHOUSE_USERNAME` / `CLICKHOUSE_PASSWORD`     | `:22-23, :40-41`                                   | ClickHouse auth. |
| `OTEL_ENABLE`                                     | `src/observability/emitter.ts`                     | `0` disables emitters. |
| `OTEL_SERVICE_NAME`                               | `:113`                                             | OTel `service.name`. |
| `TRIGGER_SECRET_KEY`                              | `src/frontend/server.ts` via SDK                   | Required to call `tasks.trigger` / `runs.*` from Express. |
| `RYANAIR_ORIGINS`                                 | cron driver, Express, sync script                  | CSV of origin IATAs. |
| `RYANAIR_CORRELATION_ID`                          | `src/airlines/ryanair.ts`                          | `fr-correlation-id` cookie value. |
| `RYANAIR_XID_COOKIE`                              | `src/airlines/ryanair.ts`                          | `xid=...`; expires, re-grab on 409. |
| `CRAWL_RYANAIR_REQUEST_DELAY_MS` / `_REQUEST_JITTER_MS` / `_COOLDOWN_MS` / `_ADULTS` | `src/config/crawl.ts`           | Override Ryanair defaults. |
| `CRAWL_EASYJET_REQUEST_DELAY_MS` / `_REQUEST_JITTER_MS` / `_COOLDOWN_MS` / `_ADULTS` | `src/config/crawl.ts`           | Override EasyJet defaults. |
| `GLOBAL_FETCH_DELAY_MS` / `GLOBAL_FETCH_JITTER_MS`| `src/lib/paced-fetch.ts`                           | Override global fetch pacing. |
| `HYPERDX_URL`                                     | `src/frontend/server.ts`                           | Default `http://localhost:8090`. |
| `FRONTEND_PORT`                                   | `src/frontend/server.ts`                           | Default `3030`. |
| `HYPERDX_OTEL_EXPORTER_CLICKHOUSE_DATABASE`       | docker-compose / ClickStack config                 | Must be `otel`. |

## 8. Validation commands

Run these before declaring any change done:

- `npm run typecheck` — `tsc --noEmit`. Currently exit 0.
- `npx trigger.dev deploy --dry-run --env <env>` — verifies the task
  surface and that all referenced task IDs / payloads are valid.
- `npx tsx scripts/run-migrations.ts` — applies migrations and
  confirms `flight_listings_latest` is queryable.
- `npx tsx scripts/smoke-observability.ts` — emits a synthetic trace
  and asserts ≥2 spans share one TraceId (regression guard for the
  active task context).
- `curl http://localhost:3030/api/health` — both ClickHouse DBs
  respond.

## 9. Things that intentionally drift vs docs

These are known inconsistencies between this contract and other
documents. They do not change the system but are tracked here so the
agent does not "fix" them:

- `AGENTS.md` Decision #6 still says `~39 min` for 9 × 93 destinations;
  the actual ETA at 25 s/call is ~5.8 h. The decision is otherwise
  accurate.
- `.env` previously lowered the Ryanair defaults to 5 s + 3 s, which
  violates the "do not lower" guard. The defaults shipped in
  `.env.example` are correct.
- `seed-crawl-queue` exists as a task but is no longer wired from the
  Express server (which calls `enqueuePendingRoutes` directly). Kept
  for back-compat / dashboard triggering.
- `crawl-ryanair-range` and `crawl-ryanair-range-route` (the
  batchTriggerAndWait fan-out that bypasses the `pending → processing
  → completed/failed` queue lifecycle) are still deployed but the
  frontend no longer triggers them as of the queue refactor. The
  endpoints `/api/trigger/full-scan` and `/api/trigger/single-origin`
  now seed the queue and call `crawl-queue-worker` instead, so the
  dashboard can show the pending work. Kept around because external
  run links still resolve and `trigger dev --dry-run` references them.
  Do not delete without explicit approval.
- `crawl-ryanair*` and `crawl-easyjet*` (legacy per-date tasks) are
  still deployed but the frontend never triggers them. Do not delete
  without explicit approval.
