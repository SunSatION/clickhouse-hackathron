# Deploy guide — Wayfare

Stack components and where each lives in production:

| Component | Where it runs | URL |
| --- | --- | --- |
| Map + admin + SSE chat (Express) | Vercel | `wayfare.allbyitself.com` |
| Background crawlers (Trigger.dev tasks) | Trigger.dev cloud (hosted on our project) | `cloud.trigger.dev` (admin only) |
| ClickHouse (data + OTel) | Self-hosted / managed instance | internal |
| HyperDX (observability UI) | Self-hosted / managed instance | optional |

Trigger.dev hosts only the background tasks — the website itself runs on Vercel.

---

## 1. Domain — `wayfare.allbyitself.com`

1. In your DNS provider for `allbyitself.com`, add a CNAME:
   ```
   wayfare.allbyitself.com  →  cname.vercel-dns.com
   ```
2. In the Vercel project → **Settings → Domains**, add `wayfare.allbyitself.com`. Vercel will issue a Let's Encrypt cert automatically.
3. (Optional) keep `allbyitself.com` itself on Vercel and route `/wayfare/*` to a second project if you ever want to share the apex.

---

## 2. Trigger.dev prod promotion

The repo is already wired with `.github/workflows/deploy-trigger-prod.yml` (auto on push to `main`) and `deploy-trigger-staging.yml` (manual dispatch). Once a GitHub secret is in place, every `git push` redeploys tasks automatically.

### First-time setup

1. Sign in to <https://cloud.trigger.dev>.
2. **Project:** `proj_owjhucduaoxtjdadhkad` already linked.
3. **Create a Personal Access Token** (profile → "Personal Access Tokens") with the `Deploy: Write` scope.
4. In your GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `TRIGGER_ACCESS_TOKEN`
   - Value: the token you just created.
5. **Promote to the prod environment** — set the prod env vars on the Trigger dashboard (project → Environments → prod → Vars). The values come from `.env.example` plus:

| Variable | Value |
| --- | --- |
| `CLICKHOUSE_URL` | your ClickHouse endpoint |
| `CLICKHOUSE_DATABASE` | `flights` |
| `CLICKHOUSE_USERNAME` / `PASSWORD` | as configured |
| `RYANAIR_CORRELATION_ID` | your correlation id |
| `RYANAIR_XID_COOKIE` | `xid=…` from a fresh browser session on ryanair.com |
| `RYANAIR_ORIGINS` | comma-separated IATAs you want crawled |
| `OTEL_DATABASE` | `otel` |
| `CRAWL_RYANAIR_REQUEST_DELAY_MS` | `20000` (do not lower — see AGENTS.md Decision #2) |
| `CRAWL_RYANAIR_REQUEST_JITTER_MS` | `10000` |
| `OPENAI_API_KEY` | your OpenAI key (used by `/api/llm/chat`) |
| `OPENAI_MODEL` | optional, e.g. `gpt-4o-mini` |
| `HYPERDX_URL` | optional URL shown in the dashboard |

> **Don't** set `TRIGGER_SECRET_KEY` — that key only lives on the machine that *calls* `tasks.trigger()` (the Vercel frontend), not inside the Trigger runtime.

### Verify

After pushing to `main`, open the Actions tab — you should see the workflow run. If it passes, the prod env in the Trigger dashboard will get a new deploy. Trigger.dev then runs a smoke build and registers every task under `src/trigger/`.

From your laptop, you can also deploy manually:
```bash
TRIGGER_ACCESS_TOKEN=tr_prod_…  npx trigger.dev@latest deploy
```

### Plan notes

- **Free plan** is fine for an MVP: $5/mo of compute credits, dev + prod envs, 20 concurrent runs, 10 concurrent Realtime connections, 1-day log retention. Each crawl-queue-worker run costs ~$3–7 of compute, so the assistant firing crawls ad-hoc fits comfortably.
- **Concurrency** is already capped at 1 on every task (`AGENTS.md` Decision #2). That's well below the Free plan's 20-concurrent limit.
- **Realtime** (live run cards in the chat sidebar) is currently being polled via `runs.retrieve()` every 2 s — this consumes 1 trigger API call per active run every 2 s. On Free plan that's ~30 req/min per active run, well under the 1500 req/min cap. If you ever switch to Realtime push (HTTP streaming), set `X-Accel-Buffering: no` (already done in `src/frontend/server.ts`).

---

## 3. Vercel (frontend)

The repo ships a partial Vercel deployment today:

- `vercel.json` rewrites `/` → `/map.html`.
- `api/map/airports.ts` exposes the airports list.
- `api/map/itinerary/` (generator, favorites, refresh) — extend as needed.

**Gap (important):** `src/frontend/server.ts` (the Express app with `/api/llm/chat`, SSE, the admin dashboard, the trigger proxy) is NOT yet wrapped in Vercel Functions. Two ways to close the gap before going public:

1. **Quickest:** Move the whole Express app to a small VPS (Hetzner/OVH/DO) and point `wayfare.allbyitself.com` at it. Cheaper and the SSE/long-poll story is simpler than Vercel's serverless ceiling.
2. **Native Vercel:** Port each route to a Vercel Function. SSE works as long as you keep responses unbuffered (`Cache-Control: no-cache`, `X-Accel-Buffering: no`) and respect the function `maxDuration` ceiling (30 s Hobby / 300 s Pro).

For the barebones demo, pick (1) — set up the VPS, set all `.env` vars, `nohup npm run frontend` behind nginx, point the CNAME.

---

## 4. Pre-launch checklist

- [ ] CNAME `wayfare.allbyitself.com` → chosen Vercel/VPS target, TLS issued.
- [ ] Trigger prod env vars set (table above).
- [ ] `TRIGGER_ACCESS_TOKEN` saved as a GitHub Actions secret.
- [ ] First push to `main` → workflow green, dashboard shows a new deploy.
- [ ] Smoke test: open `/admin` → click "Run" on "Single origin" with `MLA` (or another reachable origin) → verify a row appears in `crawl_progress_latest`.
- [ ] Smoke test: ask the assistant on `/` for a quick round trip from MLA → confirm the chat sidebar streams tool calls + the run card ticks QUEUED → EXECUTING → COMPLETED.
- [ ] Verify costs: after one demo run, check `cloud.trigger.dev → usage` to confirm spend matches expectations.
