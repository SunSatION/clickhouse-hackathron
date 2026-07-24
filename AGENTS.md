<!-- TRIGGER.DEV SKILLS START -->
## Trigger.dev agent skills

This project has Trigger.dev agent skills installed in `.agents/skills/`. Before writing or changing Trigger.dev code (background tasks, scheduled tasks, realtime, or chat.agent AI agents), load the most relevant skill: `trigger-authoring-chat-agent`, `trigger-authoring-tasks`, `trigger-chat-agent-advanced`, `trigger-realtime-and-frontend`.
<!-- TRIGGER.DEV SKILLS END -->

## System contract

Before changing task IDs, task payloads, Trigger.dev callers, ClickHouse schemas, queue semantics, crawl behavior, pacing, or observability, read [`docs/SYSTEM-CONTRACT.md`](docs/SYSTEM-CONTRACT.md). It is the canonical map of the working system and its compatibility boundaries. Do not change the documented core behavior without an explicit user request, and update the contract whenever an approved architecture change is made.

## Major decisions (read before making changes)

These are settled conventions. **Do not deviate without an explicit user request.**

### 0. `/admin` is gated by nginx basic-auth (VPS only)

- The admin panel (`/admin`) and its mutation surface (`/api/trigger/*`, `/api/scripts/*`) are protected by HTTP Basic auth in `deploy/nginx/wayfare-api.allbyitself.com.conf` using `location ^~` blocks with `auth_basic` + `auth_basic_user_file /etc/nginx/.htpasswd`.
- Public read endpoints (`/api/health`, `/api/runs*`, `/api/iatas`, `/api/tasks`, `/api/config`, `/api/otel/*`) stay open so the public map keeps working.
- Credentials live in `/etc/nginx/.htpasswd` (chmod 0640, group `www-data`). Create/update with `sudo scripts/setup-admin-auth.sh [<username>]` (bcrypt-hashed); remove with `sudo scripts/setup-admin-auth.sh --delete <username>`. The script also runs `nginx -t` and reloads nginx.
- The file `/etc/nginx/.htpasswd` is **never** committed. Re-generate from the password store (1Password / Bitwarden) if the VPS is rebuilt.
- This gate protects the VPS deployment only. The Vercel deployment (`api/index.ts` + `public/admin.html`) is separate — do not advertise `/admin` as a Vercel path until the same gate is added there.

### 1. Observability = ClickStack, in-process emitters

- OTEL tables live in the **`otel`** database (migrations `0009`, `0010`). The app writes directly to them via `getClickHouseForOtel()` — no separate collector process needed.
- Tables: `otel.otel_logs` / `otel.otel_traces` / `otel.otel_metrics_{gauge,sum,histogram,summary,exponential_histogram}`.
- The trace id is **always the `crawlRunId`** (seeded via `newTraceId(seed)` in `src/observability/ids.ts`). One crawl run = one TraceId across all its spans/logs/metrics, which joins cleanly to `flight_listings.crawl_run_id` and `crawl_progress.crawl_run_id`.
- Trace context propagates through async boundaries via `AsyncLocalStorage`, with the active Trigger.dev task context installed by `traceTask().start()` (`src/observability/context.ts`, `src/observability/task.ts`).
- Disable via `OTEL_ENABLE=0`. Never gate production behaviour on telemetry writes.
- HyperDX ClickStack must be pointed at the **`otel`** database: `HYPERDX_OTEL_EXPORTER_CLICKHOUSE_DATABASE=otel`.

### 2. Crawl rate limits + concurrency live in one place

- Single source of truth: `src/config/crawl.ts` → `CRAWL_CONFIG.{ryanair,easyjet}`. Env-overridable: `CRAWL_RYANAIR_REQUEST_DELAY_MS`, `CRAWL_RYANAIR_REQUEST_JITTER_MS`, `CRAWL_RYANAIR_COOLDOWN_MS`, `CRAWL_RYANAIR_ADULTS`, same for EasyJet.
- Hardcoded `requestDelayMs`/`requestJitterMs`/`cooldownMs`/`adults` defaults are forbidden in trigger tasks, scripts and crawler internals — they must read from `CRAWL_CONFIG`.
- Current defaults (intentional, **do not lower**): Ryanair 20s + 10s jitter, EasyJet 20s + 10s jitter, 0 cooldown, 1 adult.
- **Concurrency = 1, always.** Every Trigger.dev task in `src/trigger/` MUST declare `queue: { concurrencyLimit: 1 }`. No batching, no parallelism across origins. This guarantees the per-call Pacer defines the global rate (one request every ~25s) and keeps the load on Ryanair's API predictable.
- Effective global rate: ~1 request per 25s.

### 2b. Every HTTP request MUST be paced

- **Global safety net**: `installGlobalPacing()` patches `globalThis.fetch` at startup with a shared `Pacer` (default: 2s delay + 500ms jitter, overridable via `GLOBAL_FETCH_DELAY_MS` / `GLOBAL_FETCH_JITTER_MS`). Every `fetch()` call anywhere in the process — airline API, internal service, webhooks — is automatically paced. This is installed early via `installFetchInstrumentation()` in every trigger task and script entry point.
- **Airline-specific pacing** (`src/airlines/*.ts`): Each airline module has its own `*Pacer` singleton backed by `CRAWL_CONFIG` delays and its own `*PacedFetch` wrapper. These add airline-specific rate limiting on top of the global safety net.
  - Ryanair: `ryanairPacer` (20s + 10s jitter) → `ryanairPacedFetch()`
  - EasyJet: `easyjetPacer` (20s + 10s jitter) → `easyjetPacedFetch()`
- There are **no bare `fetch()` calls** in any `src/airlines/*.ts` file — all routes through `*PacedFetch` wrappers.
- `installFetchInstrumentation()` (called at the top of every task/script) installs global pacing first, then layers OTel telemetry on top when `OTEL_ENABLE=1`.
- **Never add a new bare `fetch()` anywhere in the codebase** without a paced guard. The global pace catches accidental bare calls but is not a substitute for explicit per-airline pacing.

### 3. Ryanair auth = `xid` cookie only

- Booking API requires `fr-correlation-id` + `xid`. No other cookie works (`agso`, `RY_COOKIE_CONSENT`, `rid` are not needed and `RYANAIR_AGSO_COOKIE` has been removed).
- `xid` expires. Re-grab from devtools → Application → Cookies on `www.ryanair.com` when `409 Availability declined` returns.
- `/api/locate/v4/routes` (route discovery) is **WAF-blocked** from this machine regardless of cookies. Destination coverage is limited to the origins currently populated in `airline_routes` and configured through `RYANAIR_ORIGINS`.
- **Backup**: `airline_routes` is backed up in two places: ClickHouse table `airline_routes_backup` (5246 rows, same schema) and `db/backup/airline_routes_backup_data.tsv`. See `db/backup/README_restore.sql` for restore instructions. Sync routes before dropping/recreating this table.

### 4. Ryanair ToU rejection is a hard error, not zero rows

- The `RyanairTermsOfUseError` class (`src/airlines/ryanair.ts`) detects both shapes: `200 + {code:"TermsOfUseAreNotAccepted"}` and `409 + {message:"Availability declined"}`.
- It tries `POST /api/agree-terms` once per correlation id (currently 404 — endpoint gone) then throws. The crawler must **never** treat this as zero trips.
- Outer crawler loop marks the destination `failed` (not `completed` with `rows_inserted=0`) and aborts the origin's fanout so we don't stamp 22 cascading failures.
- One-shot backfill: `scripts/backfill-crawl-progress.ts --mode mark-failed` (defaults to recomputing `rows_inserted` from `flight_listings`; pass `--mode mark-failed` for Ryanair ToU rejections).

### 5. `crawl_progress` is an append-only `MergeTree` log collapsed by `crawl_progress_latest`

- Schema (migration 0012 → 0016): plain `MergeTree` ordered by `(airline, origin_iata, destination_iata, date_from, date_to)`. Every state transition (seed / claim / complete / fail / requeue / stale-sweep) appends a new physical row. Claim/requeue paths use `INSERT INTO crawl_progress SELECT ... FROM crawl_progress_latest`; seed and terminal paths use direct inserts.
- The `crawl_progress_latest` view (migration 0015, updated 0016) picks the latest row per key via `argMax(value, inserted_at)`. Reads that care about current state MUST go through the view, not the base table.
- **Never use `ALTER TABLE crawl_progress UPDATE/DELETE`** — ClickHouse mutations are asynchronous and require `mutations_sync = 1` to be observable to a follow-up SELECT, which is fragile and slow. The INSERT-only pattern avoids the problem entirely (INSERTs are naturally synchronous).
- Therefore: **skip `markDestinationCompleted` when `insertedNow === 0`** — a zero-result retry must not clobber a previously-successful count. `getCompletedDestinations` also filters `rows_inserted > 0` so empty retries don't block future runs.
- When a row is "completed" with `rows_inserted=0` it almost always means upstream silently returned nothing (rate limit, ToU rejection, server-side 409) — investigate before trusting.

### 6. Range crawler math = 1 HTTP call per destination

- `crawlRyanairRangeForOrigin` iterates destinations and calls the FARFND `cheapestPerDay` endpoint once per destination for the outbound month, then filters results to `[dateFrom, dateTo]`. A 30-day window = 1 call per destination, not 30.
- ETA at current config: 832 calls for the 9 reachable origins ≈ 5.8 h; ~18,300 calls for all 199 `RYANAIR_DEFAULT_BASES` ≈ 5.3 days (blocked by Decision #3 — `/api/locate/v4/routes` is WAF-blocked from this machine).

### 7. Never drop or replace a table without migrating data first

- When dropping or replacing tables: always migrate data first, then drop. Use `RENAME TABLE` (atomic, preserves all data) or `INSERT INTO new SELECT * FROM old` + `DROP old`. Never `CREATE new` + `DROP old` without migrating data first. This applies to all tables — OTEL, flights, or anything else.

### 8. Deploy contract

- **Trigger.dev deploys are gated on `main`.** `.github/workflows/deploy-trigger-prod.yml` runs on push to `main` (filtered to `src/trigger/**`, `src/airlines/**`, `src/db/**`, `src/llm/**`, `src/lib/**`, `src/config/**`, `src/observability/**`, `trigger.config.ts`, `package.json`). Manual dispatch from the Actions tab is also wired.
- **The deploy reads `TRIGGER_ACCESS_TOKEN` from a GitHub Actions secret.** Create the token at <https://cloud.trigger.dev/account/tokens> and store it in the repo's Actions secrets. Never commit it.
- **Local manual deploys** use `npm run deploy:trigger` (prod) or `npm run deploy:trigger:staging`. They pick up `TRIGGER_ACCESS_TOKEN` from `.env` or the shell.
- **Prod env vars** (`OPENAI_API_KEY`, `RYANAIR_XID_COOKIE`, `RYANAIR_CORRELATION_ID`, `CLICKHOUSE_URL`, …) live in the Trigger dashboard (project → Environments → prod → Vars) and on the frontend host (Vercel env or VPS `.env`). Never put them in the repo.
- **The frontend** (`src/frontend/server.ts`) is NOT deployed via Trigger. It is served from Vercel (`api/` wrappers + `vercel.json`) or a VPS, separately. The deploy workflow does not touch it.
- **Vercel partial-implementation reminder:** `api/` only contains partial Vercel re-implementations today. `src/frontend/server.ts` is the source of truth and runs externally; do not edit `api/map/*` as if it were authoritative.

## Observability (ClickStack)

This project pushes **logs, traces and metrics** into ClickStack by writing
directly to the standard OTel tables in ClickHouse — no separate collector
process needed.

Tables (created by `db/migrations/0009_create_otel_database.sql` and `db/migrations/0010_otel_tables.sql`):

- `otel.otel_logs` — every `logger.*` call (and every instrumented HTTP exchange)
- `otel.otel_traces` — one row per task run; sub-spans via `withSpan`
- `otel.otel_metrics_gauge` — counter-like values (`crawl.rows_inserted`, etc.)
- `otel.otel_metrics_histogram` — request durations
- `otel.otel_metrics_sum` — monotonic counters (deferred; use if needed)
- `otel.otel_metrics_summary` — summary metrics (ClickStack schema requirement)
- `otel.otel_metrics_exponential_histogram` — exponential histogram (ClickStack schema requirement)

The trace id is **seeded from `crawlRunId`**, so a single trigger run shares
one TraceId across all its logs / metrics / spans and correlates perfectly
with `flight_listings.crawl_run_id` and `crawl_progress.crawl_run_id`.

### Pointing ClickStack at the same data

The ClickStack OTel collector image targets the database set via
`HYPERDX_OTEL_EXPORTER_CLICKHOUSE_DATABASE`. Point it at the **`otel`**
database:

```yaml
# when running the ClickStack collector image
environment:
  HYPERDX_OTEL_EXPORTER_CLICKHOUSE_DATABASE: otel
```

### Disabling observability

Set `OTEL_ENABLE=0` — all emitters become no-ops so existing crawls keep
running without writing telemetry.