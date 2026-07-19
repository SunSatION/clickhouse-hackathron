# Full scan — Ryanair endpoints, rate limits, ETA

## Endpoints used

- **`/api/booking/v4/en-gb/availability`** — per (origin, destination, date-range). Required cookies: `fr-correlation-id`, `xid`. Returns `409 Availability declined` without them.
- **`/api/locate/v4/routes`** — destination list per origin. **Blocked at WAF** (HTTP 403) for non-browser clients, even with valid `xid`. Cannot be used for route discovery from this machine.

## Request math

`crawlRyanairRangeForOrigin` makes **one** HTTP call per destination. The Ryanair API itself supports `FlexDaysOut`, so a 30-day window is one request, not 30.

```
calls = origins × destinations_per_origin
```

## ETA at current config

`CRAWL_RYANAIR_REQUEST_DELAY_MS=20000`, `CRAWL_RYANAIR_REQUEST_JITTER_MS=10000`, `concurrencyLimit: 1` on `crawlRyanairRangeRoute`.

Per-call spacing: uniform on `[20s, 30s]`, average **25s**.

| Scope | Origins | Dests | Calls | Wall time |
|---|---|---|---|---|
| 9 already-synced origins (current `airline_routes`) | 9 | 832 | 832 | **5.8 h** |
| All `RYANAIR_DEFAULT_BASES` | 199 | ~18,300 | ~18,300 | **~5.3 d** |

## Blockers

- **Route sync** is gated by CloudFront on `/api/locate/v4/routes`. `airline_routes` only contains the 9 origins in `RYANAIR_ORIGINS` (STN, DUB, BGY, CRL, BVA, BCN, MAD, FCO, MLA). Other origins in `RYANAIR_DEFAULT_BASES` will throw `"no destinations found in airline_routes"` on first call.
- **`xid` cookie expires** — re-grab from devtools when `409 Availability declined` returns.

## Config knobs (`src/config/crawl.ts`)

| Env var | Default | Effect |
|---|---|---|
| `CRAWL_RYANAIR_REQUEST_DELAY_MS` | 20000 | Min ms between calls |
| `CRAWL_RYANAIR_REQUEST_JITTER_MS` | 10000 | Random extra ms on top |
| `CRAWL_RYANAIR_COOLDOWN_MS` | 0 | Skip re-fetch within this window |
| `CRAWL_RYANAIR_ADULTS` | 1 | Adults per fare search |