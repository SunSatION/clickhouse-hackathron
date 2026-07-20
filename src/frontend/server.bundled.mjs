var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/lib/logger.ts
function formatLog(entry) {
  const tab = "  ".repeat(entry.depth);
  const parts = [`${tab}${entry.msg}`];
  parts.push(`[${entry.level.padEnd(5)}]`);
  if (entry.waitMs !== void 0) parts.push(`wait:${entry.waitMs}ms`);
  if (entry.cls) parts.push(`[${entry.cls}]`);
  parts.push(`(${entry.file})`);
  if (entry.fn) parts.push(`${entry.fn}()`);
  return parts.join(" ");
}
function logger(file) {
  function log9(level, msg, meta) {
    let depth = 0;
    if (msg.startsWith(TRACE_PREFIX)) {
      depth = globalDepth;
    } else if (msg.startsWith(EXIT_PREFIX) || msg.startsWith(THREW_PREFIX)) {
      depth = globalDepth;
      if (msg.startsWith(THREW_PREFIX)) {
        globalDepth = Math.max(0, globalDepth - 1);
      } else {
        globalDepth = Math.max(0, globalDepth - 1);
      }
    }
    const { cls: _cls, fn: _fn, waitMs, ...rest } = meta ?? {};
    const filteredMeta = Object.keys(rest).length > 0 ? rest : void 0;
    const entry = { level, t: (/* @__PURE__ */ new Date()).toISOString(), file, msg, depth, ...meta };
    if (level === "error") console.error(formatLog(entry), filteredMeta ? JSON.stringify(filteredMeta) : "");
    else if (level === "warn") console.warn(formatLog(entry), filteredMeta ? JSON.stringify(filteredMeta) : "");
    else console.log(formatLog(entry), filteredMeta ? JSON.stringify(filteredMeta) : "");
  }
  return {
    trace(msg, meta) {
      const { cls: _cls, fn: _fn, waitMs, ...rest } = meta ?? {};
      const filteredMeta = Object.keys(rest).length > 0 ? rest : void 0;
      if (msg.startsWith(TRACE_PREFIX)) {
        const entry = { level: "trace", t: (/* @__PURE__ */ new Date()).toISOString(), file, msg, depth: globalDepth, ...meta };
        console.log(formatLog(entry), filteredMeta ? JSON.stringify(filteredMeta) : "");
        globalDepth++;
      } else if (msg.startsWith(EXIT_PREFIX) || msg.startsWith(THREW_PREFIX)) {
        globalDepth = Math.max(0, globalDepth - 1);
        const entry = { level: "trace", t: (/* @__PURE__ */ new Date()).toISOString(), file, msg, depth: globalDepth, ...meta };
        console.log(formatLog(entry), filteredMeta ? JSON.stringify(filteredMeta) : "");
      } else {
        const entry = { level: "trace", t: (/* @__PURE__ */ new Date()).toISOString(), file, msg, depth: globalDepth, ...meta };
        console.log(formatLog(entry), filteredMeta ? JSON.stringify(filteredMeta) : "");
      }
    },
    debug(msg, meta) {
      log9("debug", msg, meta);
    },
    info(msg, meta) {
      log9("info", msg, meta);
    },
    warn(msg, meta) {
      log9("warn", msg, meta);
    },
    error(msg, meta) {
      log9("error", msg, meta);
    }
  };
}
var TRACE_PREFIX, EXIT_PREFIX, THREW_PREFIX, globalDepth;
var init_logger = __esm({
  "src/lib/logger.ts"() {
    "use strict";
    TRACE_PREFIX = ">>> ";
    EXIT_PREFIX = "<<< ";
    THREW_PREFIX = "!!! ";
    globalDepth = 0;
  }
});

// src/config/crawl.ts
function intEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}
var CRAWL_CONFIG;
var init_crawl = __esm({
  "src/config/crawl.ts"() {
    "use strict";
    CRAWL_CONFIG = {
      ryanair: {
        requestDelayMs: intEnv("CRAWL_RYANAIR_REQUEST_DELAY_MS", 2e4),
        requestJitterMs: intEnv("CRAWL_RYANAIR_REQUEST_JITTER_MS", 1e4),
        cooldownMs: intEnv("CRAWL_RYANAIR_COOLDOWN_MS", 0),
        adults: intEnv("CRAWL_RYANAIR_ADULTS", 1)
      },
      easyjet: {
        requestDelayMs: intEnv("CRAWL_EASYJET_REQUEST_DELAY_MS", 2e4),
        requestJitterMs: intEnv("CRAWL_EASYJET_REQUEST_JITTER_MS", 1e4),
        cooldownMs: intEnv("CRAWL_EASYJET_COOLDOWN_MS", 0),
        adults: intEnv("CRAWL_EASYJET_ADULTS", 1)
      }
    };
  }
});

// src/db/clickhouse.ts
var clickhouse_exports = {};
__export(clickhouse_exports, {
  getClickHouse: () => getClickHouse,
  getClickHouseForOtel: () => getClickHouseForOtel,
  pingClickHouse: () => pingClickHouse
});
import {
  createClient
} from "@clickhouse/client";
function getClickHouse() {
  if (client) return client;
  const url = process.env.CLICKHOUSE_URL ?? "http://localhost:8123";
  const database = process.env.CLICKHOUSE_DATABASE ?? "default";
  client = createClient({
    url,
    database,
    request_timeout: 9e4,
    max_open_connections: 10,
    compression: { request: true, response: true },
    username: process.env.CLICKHOUSE_USERNAME,
    password: process.env.CLICKHOUSE_PASSWORD
  });
  return client;
}
function getClickHouseForOtel() {
  if (otelClient) return otelClient;
  const url = process.env.CLICKHOUSE_URL ?? "http://localhost:8123";
  const database = process.env.OTEL_DATABASE ?? "otel";
  otelClient = createClient({
    url,
    database,
    request_timeout: 9e4,
    max_open_connections: 10,
    compression: { request: true, response: true },
    username: process.env.CLICKHOUSE_USERNAME,
    password: process.env.CLICKHOUSE_PASSWORD
  });
  return otelClient;
}
async function pingClickHouse() {
  const result = await getClickHouse().ping();
  return Boolean(result.success);
}
var client, otelClient;
var init_clickhouse = __esm({
  "src/db/clickhouse.ts"() {
    "use strict";
  }
});

// src/db/airline-routes.ts
var airline_routes_exports = {};
__export(airline_routes_exports, {
  countAirlineRoutes: () => countAirlineRoutes,
  getDestinationsForAirlineOrigin: () => getDestinationsForAirlineOrigin,
  getDestinationsWithNamesForAirlineOrigin: () => getDestinationsWithNamesForAirlineOrigin,
  getRoutesForAirlineOrigins: () => getRoutesForAirlineOrigins,
  upsertAirlineRoutes: () => upsertAirlineRoutes
});
async function upsertAirlineRoutes(airlineCode, origin, routes) {
  if (routes.length === 0) return 0;
  const upperAirline = airlineCode.toUpperCase();
  const upperOrigin = origin.toUpperCase();
  const values = routes.map((r) => ({
    airline_code: upperAirline,
    origin_iata: upperOrigin,
    destination_iata: r.destination_iata.toUpperCase(),
    destination_name: r.destination_name ?? "",
    base: r.base ?? false,
    fetched_at: (/* @__PURE__ */ new Date()).toISOString()
  }));
  await getClickHouse().insert({
    table: "airline_routes",
    format: "JSONEachRow",
    values
  });
  return values.length;
}
async function getDestinationsForAirlineOrigin(airlineCode, origin) {
  const rs = await getClickHouse().query({
    query: `SELECT destination_iata FROM airline_routes FINAL WHERE airline_code = {airline:String} AND origin_iata = {origin:String}`,
    query_params: {
      airline: airlineCode.toUpperCase(),
      origin: origin.toUpperCase()
    },
    format: "JSONEachRow"
  });
  const rows = await rs.json();
  return new Set(rows.map((r) => r.destination_iata.toUpperCase()));
}
async function getDestinationsWithNamesForAirlineOrigin(airlineCode, origin) {
  const rs = await getClickHouse().query({
    query: `
      SELECT destination_iata, destination_name
      FROM airline_routes FINAL
      WHERE airline_code = {airline:String}
        AND origin_iata = {origin:String}
    `,
    query_params: {
      airline: airlineCode.toUpperCase(),
      origin: origin.toUpperCase()
    },
    format: "JSONEachRow"
  });
  const rows = await rs.json();
  const map = /* @__PURE__ */ new Map();
  for (const r of rows) {
    map.set(r.destination_iata.toUpperCase(), r.destination_name ?? "");
  }
  return map;
}
async function getRoutesForAirlineOrigins(airlineCode, origins) {
  const map = /* @__PURE__ */ new Map();
  for (const o of origins) map.set(o.toUpperCase(), /* @__PURE__ */ new Set());
  if (origins.length === 0) return map;
  const rs = await getClickHouse().query({
    query: `SELECT origin_iata, destination_iata FROM airline_routes FINAL WHERE airline_code = {airline:String} AND origin_iata IN {origins:Array(String)}`,
    query_params: {
      airline: airlineCode.toUpperCase(),
      origins: origins.map((o) => o.toUpperCase())
    },
    format: "JSONEachRow"
  });
  const rows = await rs.json();
  for (const r of rows) {
    const set = map.get(r.origin_iata.toUpperCase());
    if (set) set.add(r.destination_iata.toUpperCase());
  }
  return map;
}
async function countAirlineRoutes(airlineCode) {
  const rs = await getClickHouse().query({
    query: airlineCode ? `SELECT count() AS n FROM airline_routes FINAL WHERE airline_code = {airline:String}` : "SELECT count() AS n FROM airline_routes FINAL",
    query_params: airlineCode ? { airline: airlineCode.toUpperCase() } : void 0,
    format: "JSONEachRow"
  });
  const rows = await rs.json();
  return Number(rows[0]?.n ?? 0);
}
var init_airline_routes = __esm({
  "src/db/airline-routes.ts"() {
    "use strict";
    init_clickhouse();
  }
});

// src/db/crawl-progress.ts
var crawl_progress_exports = {};
__export(crawl_progress_exports, {
  claimNextPendingItem: () => claimNextPendingItem,
  claimSpecificPendingItem: () => claimSpecificPendingItem,
  enqueuePendingRoutes: () => enqueuePendingRoutes,
  getClaimedDestinations: () => getClaimedDestinations,
  getCompletedDestinations: () => getCompletedDestinations,
  getCurrentRowState: () => getCurrentRowState,
  getQueueStats: () => getQueueStats,
  listFailedDestinations: () => listFailedDestinations,
  listPendingItems: () => listPendingItems,
  listProgress: () => listProgress,
  markDestinationCompleted: () => markDestinationCompleted,
  markDestinationFailed: () => markDestinationFailed,
  markProgressCompleted: () => markProgressCompleted,
  markProgressFailed: () => markProgressFailed,
  requeueDestinations: () => requeueDestinations
});
async function enqueuePendingRoutes(opts) {
  const ch = getClickHouse();
  const { getRoutesForAirlineOrigins: getRoutesForAirlineOrigins2 } = await Promise.resolve().then(() => (init_airline_routes(), airline_routes_exports));
  const routesMap = await getRoutesForAirlineOrigins2(opts.airline, opts.origins);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const existingKeys = await listExistingProgressKeys({
    airline: opts.airline,
    origins: opts.origins,
    dateFrom: opts.dateFrom,
    dateTo: opts.dateTo
  });
  const rows = [];
  let alreadyTracked = 0;
  for (const [origin, destinations] of routesMap) {
    if (destinations.size === 0) continue;
    for (const destination of destinations) {
      const key = `${origin}|${destination}`;
      if (existingKeys.has(key)) {
        alreadyTracked += 1;
        continue;
      }
      rows.push({
        airline: opts.airline,
        origin_iata: origin,
        destination_iata: destination,
        date_from: opts.dateFrom,
        date_to: opts.dateTo,
        status: "pending",
        crawl_run_id: opts.crawlRunId ?? "",
        inserted_at: now,
        updated_at: now
      });
    }
  }
  if (rows.length === 0) {
    return { enqueued: 0, already_pending: alreadyTracked };
  }
  await ch.insert({
    table: "crawl_progress",
    format: "JSONEachRow",
    values: rows
  });
  return { enqueued: rows.length, already_pending: alreadyTracked };
}
async function listExistingProgressKeys(opts) {
  if (opts.origins.length === 0) return /* @__PURE__ */ new Set();
  const placeholders = opts.origins.map((_, i) => `{origin${i}:String}`).join(", ");
  const queryParams = {
    airline: opts.airline,
    dateFrom: opts.dateFrom,
    dateTo: opts.dateTo
  };
  opts.origins.forEach((o, i) => {
    queryParams[`origin${i}`] = o.toUpperCase();
  });
  const result = await getClickHouse().query({
    query: `
      SELECT origin_iata, destination_iata
      FROM crawl_progress_latest
      WHERE airline = {airline:String}
        AND origin_iata IN (${placeholders})
        AND date_from = {dateFrom:Date}
        AND date_to = {dateTo:Date}
        AND (
          status IN ('pending', 'processing')
          OR (status = 'completed' AND rows_inserted > 0)
        )
    `,
    query_params: queryParams,
    format: "JSONEachRow"
  });
  const rows = await result.json();
  return new Set(
    rows.map((r) => `${String(r.origin_iata).toUpperCase()}|${String(r.destination_iata).toUpperCase()}`)
  );
}
async function claimSpecificPendingItem(opts) {
  const ch = getClickHouse();
  const statusFilter = opts.force ? "status IN ('pending', 'processing', 'completed', 'failed')" : "status = 'pending'";
  const existingResult = await ch.query({
    query: `
      SELECT airline, origin_iata, destination_iata, date_from, date_to
      FROM crawl_progress_latest FINAL
      WHERE airline = {airline:String}
        AND origin_iata = {origin:String}
        AND destination_iata = {destination:String}
        AND date_from = {dateFrom:Date}
        AND date_to = {dateTo:Date}
        AND ${statusFilter}
      LIMIT 1
    `,
    query_params: {
      airline: opts.airline,
      origin: opts.originIata.toUpperCase(),
      destination: opts.destinationIata.toUpperCase(),
      dateFrom: opts.dateFrom,
      dateTo: opts.dateTo
    },
    format: "JSONEachRow"
  });
  const existing = await existingResult.json();
  if (!existing[0]) return null;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await ch.insert({
    table: "crawl_progress",
    format: "JSONEachRow",
    values: [
      {
        airline: existing[0].airline,
        origin_iata: existing[0].origin_iata,
        destination_iata: existing[0].destination_iata,
        date_from: existing[0].date_from,
        date_to: existing[0].date_to,
        status: "processing",
        crawl_run_id: opts.crawlRunId,
        rows_inserted: 0,
        error_message: "",
        started_at: now,
        completed_at: now,
        inserted_at: now,
        updated_at: now
      }
    ]
  });
  return {
    airline: existing[0].airline,
    origin_iata: existing[0].origin_iata,
    destination_iata: existing[0].destination_iata,
    date_from: existing[0].date_from,
    date_to: existing[0].date_to,
    status: "processing",
    crawl_run_id: opts.crawlRunId,
    rows_inserted: 0,
    error_message: "",
    started_at: now,
    completed_at: now,
    inserted_at: now,
    updated_at: now
  };
}
async function getCurrentRowState(opts) {
  const result = await getClickHouse().query({
    query: `
      SELECT *
      FROM crawl_progress_latest
      WHERE airline = {airline:String}
        AND origin_iata = {origin:String}
        AND destination_iata = {destination:String}
        AND date_from = {dateFrom:Date}
        AND date_to = {dateTo:Date}
    `,
    query_params: {
      airline: opts.airline,
      origin: opts.originIata.toUpperCase(),
      destination: opts.destinationIata.toUpperCase(),
      dateFrom: opts.dateFrom,
      dateTo: opts.dateTo
    },
    format: "JSONEachRow"
  });
  const rows = await result.json();
  return rows.map((r) => ({
    ...r,
    origin_iata: String(r.origin_iata).toUpperCase(),
    destination_iata: String(r.destination_iata).toUpperCase()
  }));
}
async function listPendingItems(opts) {
  const limit = Math.min(Math.max(1, opts.limit ?? 200), 1e3);
  const conditions = [
    "airline = {airline:String}",
    "status = 'pending'"
  ];
  const queryParams = {
    airline: opts.airline
  };
  if (opts.originIata) {
    conditions.push("origin_iata = {origin:String}");
    queryParams.origin = opts.originIata.toUpperCase();
  }
  const result = await getClickHouse().query({
    query: `
      SELECT *
      FROM crawl_progress_latest
      WHERE ${conditions.join(" AND ")}
      ORDER BY inserted_at
      LIMIT {limit:UInt32}
    `,
    query_params: { ...queryParams, limit },
    format: "JSONEachRow"
  });
  const rows = await result.json();
  return rows.map((r) => ({
    ...r,
    origin_iata: String(r.origin_iata).toUpperCase(),
    destination_iata: String(r.destination_iata).toUpperCase()
  }));
}
async function claimNextPendingItem(opts) {
  const ch = getClickHouse();
  const staleAfterMs = opts.staleAfterMs ?? 30 * 60 * 1e3;
  const staleCutoff = new Date(Date.now() - staleAfterMs).toISOString().slice(0, 19).replace("T", " ");
  await ch.command({
    query: `
      INSERT INTO crawl_progress
      SELECT
        airline, origin_iata, destination_iata, date_from, date_to,
        'failed' AS status, crawl_run_id,
        0 AS rows_inserted,
        'stale worker, auto-failed' AS error_message,
        started_at, now() AS completed_at, now() + INTERVAL 1 SECOND AS inserted_at, now() AS updated_at
      FROM crawl_progress_latest
      WHERE airline = {airline:String}
        AND status = 'processing'
        AND started_at < {staleCutoff:DateTime}
    `,
    query_params: {
      airline: opts.airline,
      staleCutoff
    }
  }).catch((e) => {
    console.warn("Stale sweep INSERT...SELECT failed (non-fatal)", e.message);
  });
  const nextResult = await ch.query({
    query: `
      SELECT airline, origin_iata, destination_iata, date_from, date_to
      FROM crawl_progress_latest FINAL
      WHERE airline = {airline:String}
        AND status = 'pending'
        AND (crawl_run_id = '' OR crawl_run_id = {crawlRunId:String})
      ORDER BY inserted_at ASC
      LIMIT 1
    `,
    query_params: {
      airline: opts.airline,
      crawlRunId: opts.crawlRunId
    },
    format: "JSONEachRow"
  }).catch((e) => {
    console.warn("Pending SELECT failed", e.message);
    return null;
  });
  if (!nextResult) return null;
  const nextRows = await nextResult.json();
  const next = nextRows[0];
  if (!next) return null;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await ch.insert({
    table: "crawl_progress",
    format: "JSONEachRow",
    values: [
      {
        airline: next.airline,
        origin_iata: next.origin_iata,
        destination_iata: next.destination_iata,
        date_from: next.date_from,
        date_to: next.date_to,
        status: "processing",
        crawl_run_id: opts.crawlRunId,
        rows_inserted: 0,
        error_message: "",
        started_at: now,
        completed_at: now,
        inserted_at: now,
        updated_at: now
      }
    ]
  });
  const claimed = await ch.query({
    query: `
      SELECT *
      FROM crawl_progress_latest
      WHERE status = 'processing'
        AND airline = {airline:String}
        AND crawl_run_id = {crawlRunId:String}
        AND origin_iata = {originIata:String}
        AND destination_iata = {destinationIata:String}
        AND date_from = {dateFrom:Date}
        AND date_to = {dateTo:Date}
      LIMIT 1
    `,
    query_params: {
      airline: opts.airline,
      crawlRunId: opts.crawlRunId,
      originIata: next.origin_iata,
      destinationIata: next.destination_iata,
      dateFrom: next.date_from,
      dateTo: next.date_to
    },
    format: "JSONEachRow"
  });
  const claimedRows = await claimed.json();
  return claimedRows[0] ?? null;
}
async function markProgressCompleted(opts) {
  const now = /* @__PURE__ */ new Date();
  const nowIso = now.toISOString();
  const terminalInsertedAt = new Date(now.getTime() + 1e3).toISOString();
  await getClickHouse().insert({
    table: "crawl_progress",
    format: "JSONEachRow",
    values: [
      {
        airline: opts.airline,
        origin_iata: opts.originIata.toUpperCase(),
        destination_iata: opts.destinationIata.toUpperCase(),
        date_from: opts.dateFrom,
        date_to: opts.dateTo,
        status: "completed",
        crawl_run_id: opts.crawlRunId,
        rows_inserted: opts.rowsInserted,
        error_message: "",
        started_at: nowIso,
        completed_at: nowIso,
        inserted_at: terminalInsertedAt,
        updated_at: terminalInsertedAt
      }
    ]
  });
}
async function markProgressFailed(opts) {
  const now = /* @__PURE__ */ new Date();
  const nowIso = now.toISOString();
  const terminalInsertedAt = new Date(now.getTime() + 1e3).toISOString();
  await getClickHouse().insert({
    table: "crawl_progress",
    format: "JSONEachRow",
    values: [
      {
        airline: opts.airline,
        origin_iata: opts.originIata.toUpperCase(),
        destination_iata: opts.destinationIata.toUpperCase(),
        date_from: opts.dateFrom,
        date_to: opts.dateTo,
        status: "failed",
        crawl_run_id: opts.crawlRunId,
        rows_inserted: 0,
        error_message: opts.error.slice(0, 1e3),
        started_at: nowIso,
        completed_at: nowIso,
        inserted_at: terminalInsertedAt,
        updated_at: terminalInsertedAt
      }
    ]
  });
}
async function getClaimedDestinations(opts) {
  const result = await getClickHouse().query({
    query: `
      SELECT destination_iata
      FROM crawl_progress_latest
      WHERE airline = {airline:String}
        AND origin_iata = {origin:String}
        AND date_from = {dateFrom:Date}
        AND date_to = {dateTo:Date}
        AND (
          (status = 'completed' AND rows_inserted > 0)
          OR status = 'processing'
        )
    `,
    query_params: {
      airline: opts.airline,
      origin: opts.originIata.toUpperCase(),
      dateFrom: opts.dateFrom,
      dateTo: opts.dateTo
    },
    format: "JSONEachRow"
  });
  const rows = await result.json();
  return new Set(
    rows.map(
      (r) => String(r.destination_iata).toUpperCase()
    )
  );
}
async function getCompletedDestinations(opts) {
  const result = await getClickHouse().query({
    query: `
      SELECT destination_iata
      FROM crawl_progress_latest
      WHERE airline = {airline:String}
        AND origin_iata = {origin:String}
        AND date_from = {dateFrom:Date}
        AND date_to = {dateTo:Date}
        AND status = 'completed'
        AND rows_inserted > 0
    `,
    query_params: {
      airline: opts.airline,
      origin: opts.originIata.toUpperCase(),
      dateFrom: opts.dateFrom,
      dateTo: opts.dateTo
    },
    format: "JSONEachRow"
  });
  const rows = await result.json();
  return new Set(
    rows.map(
      (r) => String(r.destination_iata).toUpperCase()
    )
  );
}
async function listProgress(opts) {
  const result = await getClickHouse().query({
    query: `
      SELECT
        destination_iata,
        status,
        crawl_run_id,
        rows_inserted,
        error_message,
        formatDateTime(started_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS started_at,
        formatDateTime(completed_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS completed_at
      FROM crawl_progress_latest
      WHERE airline = {airline:String}
        AND origin_iata = {origin:String}
        AND date_from = {dateFrom:Date}
        AND date_to = {dateTo:Date}
      ORDER BY destination_iata
    `,
    query_params: {
      airline: opts.airline,
      origin: opts.originIata.toUpperCase(),
      dateFrom: opts.dateFrom,
      dateTo: opts.dateTo
    },
    format: "JSONEachRow"
  });
  const rows = await result.json();
  return rows.map((r) => ({
    ...r,
    destination_iata: String(r.destination_iata).toUpperCase()
  }));
}
async function listFailedDestinations(opts) {
  const result = await getClickHouse().query({
    query: `
      SELECT
        destination_iata,
        error_message,
        crawl_run_id,
        formatDateTime(completed_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS completed_at
      FROM crawl_progress_latest
      WHERE airline = {airline:String}
        AND origin_iata = {origin:String}
        AND date_from = {dateFrom:Date}
        AND date_to = {dateTo:Date}
        AND status = 'failed'
      ORDER BY destination_iata
    `,
    query_params: {
      airline: opts.airline,
      origin: opts.originIata.toUpperCase(),
      dateFrom: opts.dateFrom,
      dateTo: opts.dateTo
    },
    format: "JSONEachRow"
  });
  const rows = await result.json();
  return rows.map((r) => ({
    ...r,
    destination_iata: String(r.destination_iata).toUpperCase()
  }));
}
async function requeueDestinations(opts) {
  const includeFailed = opts.includeFailed ?? true;
  const includeCompleted = opts.includeCompleted ?? false;
  const statuses = [];
  if (includeFailed) statuses.push("'failed'");
  if (includeCompleted) statuses.push("'completed'");
  if (statuses.length === 0) return 0;
  const conditions = [
    "airline = {airline:String}",
    "origin_iata = {origin:String}",
    "date_from = {dateFrom:Date}",
    "date_to = {dateTo:Date}",
    `status IN (${statuses.join(", ")})`
  ];
  const queryParams = {
    airline: opts.airline,
    origin: opts.originIata.toUpperCase(),
    dateFrom: opts.dateFrom,
    dateTo: opts.dateTo
  };
  if (opts.destinations && opts.destinations.length > 0) {
    const upper = opts.destinations.map((d) => d.toUpperCase());
    const placeholders = upper.map((_, i) => `{dest${i}:String}`).join(", ");
    conditions.push(`destination_iata IN (${placeholders})`);
    upper.forEach((d, i) => {
      queryParams[`dest${i}`] = d;
    });
  }
  await getClickHouse().command({
    query: `
      INSERT INTO crawl_progress
      SELECT
        airline,
        origin_iata,
        destination_iata,
        date_from,
        date_to,
        'pending' AS status,
        {crawlRunId:String} AS crawl_run_id,
        0 AS rows_inserted,
        '' AS error_message,
        now() AS started_at,
        now() AS completed_at,
        now() AS inserted_at,
        now() AS updated_at
      FROM crawl_progress_latest
      WHERE ${conditions.join(" AND ")}
    `,
    query_params: { ...queryParams, crawlRunId: opts.crawlRunId ?? "" }
  });
  const countResult = await getClickHouse().query({
    query: `
      SELECT count() AS n
      FROM crawl_progress_latest
      WHERE ${conditions.join(" AND ")}
    `,
    query_params: queryParams,
    format: "JSONEachRow"
  });
  const [row] = await countResult.json();
  return Number(row?.n ?? 0);
}
async function getQueueStats(opts) {
  const result = await getClickHouse().query({
    query: `
      SELECT status, count() AS cnt
      FROM crawl_progress_latest
      WHERE airline = {airline:String}
      GROUP BY status
    `,
    query_params: { airline: opts.airline },
    format: "JSONEachRow"
  });
  const rows = await result.json();
  const stats = { pending: 0, processing: 0, completed: 0, failed: 0 };
  for (const row of rows) {
    if (row.status in stats) {
      stats[row.status] = row.cnt;
    }
  }
  return stats;
}
async function markDestinationCompleted(opts) {
  await markProgressCompleted(opts);
}
async function markDestinationFailed(opts) {
  await markProgressFailed(opts);
}
var init_crawl_progress = __esm({
  "src/db/crawl-progress.ts"() {
    "use strict";
    init_clickhouse();
  }
});

// src/db/airports.ts
var airports_exports = {};
__export(airports_exports, {
  airportsForCountry: () => airportsForCountry,
  detectCountriesFromPrompt: () => detectCountriesFromPrompt,
  filterAirportsByAirline: () => filterAirportsByAirline,
  findCheapestRoundTrip: () => findCheapestRoundTrip,
  findCheapestRoutesBetween: () => findCheapestRoutesBetween,
  getAirport: () => getAirport,
  listAirportsForAirline: () => listAirportsForAirline,
  listAirportsWithRouteCounts: () => listAirportsWithRouteCounts,
  listAllAirports: () => listAllAirports,
  listFaresForAirport: () => listFaresForAirport,
  searchAirports: () => searchAirports
});
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
function airportsJsonPath() {
  return join(import.meta.dirname, "..", "..", "public", "data", "airports.json");
}
function loadFromDisk() {
  const path = airportsJsonPath();
  if (!existsSync(path)) {
    throw new Error(
      `airports.json not found at ${path} \u2014 run: npx tsx scripts/build-airports-json.ts`
    );
  }
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw);
}
function listAllAirports() {
  if (allCache) return allCache;
  const data = loadFromDisk();
  allCache = data.airports;
  cache = new Map(allCache.map((a) => [a.iata, a]));
  log3.info("Loaded airports dataset", { count: allCache.length });
  return allCache;
}
function getAirport(iata) {
  if (!cache) listAllAirports();
  return cache?.get(iata.toUpperCase()) ?? null;
}
function searchAirports(query, limit = 25) {
  const q = query.trim().toLowerCase();
  const all = listAllAirports();
  if (!q) return all.slice(0, limit);
  const hits = [];
  for (const a of all) {
    if (a.iata.toLowerCase().includes(q) || a.city.toLowerCase().includes(q) || a.name.toLowerCase().includes(q) || a.country.toLowerCase() === q) {
      hits.push(a);
      if (hits.length >= limit) break;
    }
  }
  return hits;
}
async function listAirportsForAirline(airline = "Ryanair") {
  const all = listAllAirports();
  const ch = getClickHouse();
  const code = airline.toUpperCase();
  const r = await ch.query({
    query: `
      SELECT origin_iata AS iata, count() AS n
      FROM airline_routes FINAL
      WHERE airline_code = {code:String}
      GROUP BY origin_iata
    `,
    query_params: { code },
    format: "JSONEachRow"
  });
  const originRows = await r.json();
  const byIata = new Map(originRows.map((row) => [String(row.iata).toUpperCase(), Number(row.n)]));
  const dr = await ch.query({
    query: `
      SELECT DISTINCT destination_iata AS iata
      FROM airline_routes FINAL
      WHERE airline_code = {code:String}
    `,
    query_params: { code },
    format: "JSONEachRow"
  });
  const destRows = await dr.json();
  for (const row of destRows) {
    const iata = String(row.iata).toUpperCase();
    if (!byIata.has(iata)) byIata.set(iata, 0);
  }
  return all.filter((a) => byIata.has(a.iata)).map((a) => ({
    ...a,
    originCount: byIata.get(a.iata) ?? 0,
    destinationCount: 0
  })).sort((x, y) => y.originCount - x.originCount || x.iata.localeCompare(y.iata));
}
async function listAirportsWithRouteCounts(airline) {
  return listAirportsForAirline(airline ?? "Ryanair");
}
function filterAirportsByAirline(airports) {
  return airports.filter((a) => a.originCount > 0);
}
async function listFaresForAirport(q) {
  const ch = getClickHouse();
  const params = { iata: q.iata.toUpperCase() };
  const conditions = ["(origin_iata = {iata:String} OR destination_iata = {iata:String})"];
  if (q.airline) {
    conditions.push("airline_code = {airline:String}");
    params.airline = q.airline;
  }
  if (q.dateFrom) {
    conditions.push("departure_date >= {dateFrom:Date}");
    params.dateFrom = q.dateFrom;
  }
  if (q.dateTo) {
    conditions.push("departure_date <= {dateTo:Date}");
    params.dateTo = q.dateTo;
  }
  const limit = Math.min(Math.max(1, q.limit ?? 200), 1e3);
  params.limit = limit;
  const r = await ch.query({
    query: `${FARE_BASE_QUERY}
      WHERE ${conditions.join(" AND ")}
      ORDER BY departure_date ASC, price ASC
      LIMIT {limit:UInt32}`,
    query_params: params,
    format: "JSONEachRow"
  });
  const rows = await r.json();
  return rows.map((row) => ({
    airline: String(row.airline ?? ""),
    airlineCode: String(row.airline_code ?? ""),
    flightNumber: String(row.flight_number ?? ""),
    origin: String(row.origin_iata ?? "").toUpperCase(),
    destination: String(row.destination_iata ?? "").toUpperCase(),
    departureDate: String(row.departure_date ?? "").slice(0, 10),
    departureDatetime: row.departure_datetime ? String(row.departure_datetime) : null,
    arrivalDatetime: row.arrival_datetime ? String(row.arrival_datetime) : null,
    durationMinutes: row.duration_minutes != null ? Number(row.duration_minutes) : null,
    currency: String(row.currency ?? "EUR"),
    price: Number(row.price ?? 0),
    originalPrice: row.original_price != null ? Number(row.original_price) : null,
    fareType: String(row.fare_type ?? ""),
    fareClass: String(row.fare_class ?? ""),
    seatsLeft: row.seats_left != null ? Number(row.seats_left) : null,
    observedAt: String(row.observed_at ?? ""),
    crawlRunId: String(row.crawl_run_id ?? "")
  }));
}
function detectCountriesFromPrompt(prompt) {
  const p = prompt.toLowerCase();
  const found = [];
  for (const [key, name] of Object.entries(COUNTRY_NAMES)) {
    const pat = key.replace(/_/g, " ");
    if (p.includes(pat) || p.includes(name.toLowerCase())) found.push(key);
  }
  return found;
}
function airportsForCountry(country) {
  return COUNTRY_TO_IATA[country] ?? [];
}
async function findCheapestRoutesBetween(pairs, dateFrom, dateTo, preferredAirlines = []) {
  const ch = getClickHouse();
  const out = /* @__PURE__ */ new Map();
  if (pairs.length === 0) return out;
  const originCodes = Array.from(new Set(pairs.map((p) => p.origin)));
  const destCodes = Array.from(new Set(pairs.map((p) => p.destination)));
  const params = {
    origins: originCodes,
    dests: destCodes,
    dateFrom,
    dateTo
  };
  const airlineFilter = preferredAirlines.length > 0 ? "AND airline_code IN {airlines:Array(String)}" : "";
  if (preferredAirlines.length > 0) params.airlines = preferredAirlines;
  const r = await ch.query({
    query: `
      SELECT
        origin_iata,
        destination_iata,
        min(price) AS min_price,
        any(currency) AS currency,
        min(departure_date) AS best_date,
        any(airline) AS airline,
        any(duration_minutes) AS duration_minutes
      FROM flight_listings_latest
      WHERE origin_iata IN {origins:Array(String)}
        AND destination_iata IN {dests:Array(String)}
        AND departure_date >= {dateFrom:Date}
        AND departure_date <= {dateTo:Date}
        ${airlineFilter}
      GROUP BY origin_iata, destination_iata
    `,
    query_params: params,
    format: "JSONEachRow"
  });
  const rows = await r.json();
  for (const row of rows) {
    const origin = String(row.origin_iata).toUpperCase();
    const destination = String(row.destination_iata).toUpperCase();
    out.set(`${origin}|${destination}`, {
      origin,
      destination,
      price: Number(row.min_price ?? 0),
      currency: String(row.currency ?? "EUR"),
      date: String(row.best_date ?? "").slice(0, 10),
      airline: String(row.airline ?? ""),
      durationMinutes: row.duration_minutes != null ? Number(row.duration_minutes) : null
    });
  }
  return out;
}
async function findCheapestRoundTrip(q) {
  const ch = getClickHouse();
  const origin = q.origin.toUpperCase();
  const destination = q.destination.toUpperCase();
  const minDays = Math.max(1, Math.min(60, q.minDays ?? 3));
  const maxDays = Math.max(minDays, Math.min(60, q.maxDays ?? 14));
  const r = await ch.query({
    query: `
      SELECT
        origin_iata,
        destination_iata,
        departure_date,
        min(price) AS min_price,
        any(currency) AS currency,
        any(airline) AS airline,
        any(duration_minutes) AS duration_minutes
      FROM flight_listings
      WHERE (
            (origin_iata = {origin:String} AND destination_iata = {destination:String})
         OR (origin_iata = {destination:String} AND destination_iata = {origin:String})
          )
        AND departure_date >= {dateFrom:Date}
        AND departure_date <= {dateTo:Date}
      GROUP BY origin_iata, destination_iata, departure_date
      ORDER BY departure_date ASC
    `,
    query_params: { origin, destination, dateFrom: q.dateFrom, dateTo: q.dateTo },
    format: "JSONEachRow"
  });
  const rows = await r.json();
  const outbound = rows.filter((r2) => String(r2.origin_iata).toUpperCase() === origin);
  const inbound = rows.filter((r2) => String(r2.origin_iata).toUpperCase() === destination);
  const results = [];
  for (const ob of outbound) {
    const obDate = String(ob.departure_date ?? "").slice(0, 10);
    for (const ib of inbound) {
      const ibDate = String(ib.departure_date ?? "").slice(0, 10);
      if (!obDate || !ibDate || ibDate <= obDate) continue;
      const tripDays = Math.round(
        ((/* @__PURE__ */ new Date(ibDate + "T00:00:00Z")).getTime() - (/* @__PURE__ */ new Date(obDate + "T00:00:00Z")).getTime()) / 864e5
      );
      if (tripDays < minDays || tripDays > maxDays) continue;
      const totalPrice = Number(ob.min_price ?? 0) + Number(ib.min_price ?? 0);
      const currency = String(ob.currency ?? ib.currency ?? "EUR");
      results.push({
        origin,
        destination,
        outbound: {
          origin,
          destination,
          price: Number(ob.min_price ?? 0),
          currency,
          date: obDate,
          airline: String(ob.airline ?? ""),
          durationMinutes: ob.duration_minutes != null ? Number(ob.duration_minutes) : null
        },
        return: {
          origin: destination,
          destination: origin,
          price: Number(ib.min_price ?? 0),
          currency,
          date: ibDate,
          airline: String(ib.airline ?? ""),
          durationMinutes: ib.duration_minutes != null ? Number(ib.duration_minutes) : null
        },
        tripDays,
        totalPrice,
        currency
      });
    }
  }
  results.sort((a, b) => a.totalPrice - b.totalPrice || a.tripDays - b.tripDays);
  return results;
}
var log3, cache, allCache, FARE_BASE_QUERY, COUNTRY_TO_IATA, COUNTRY_NAMES;
var init_airports = __esm({
  "src/db/airports.ts"() {
    "use strict";
    init_clickhouse();
    init_logger();
    log3 = logger("src/db/airports.ts");
    cache = null;
    allCache = null;
    FARE_BASE_QUERY = `
  SELECT
    airline,
    airline_code,
    flight_number,
    origin_iata,
    destination_iata,
    departure_date,
    departure_datetime,
    arrival_datetime,
    duration_minutes,
    currency,
    price,
    original_price,
    fare_type,
    fare_class,
    seats_left,
    latest_observed_at AS observed_at,
    crawl_run_id
  FROM flight_listings_latest
`;
    COUNTRY_TO_IATA = {
      malta: ["MLA"],
      italy: ["FCO", "CIA", "MXP", "BGY", "VCE", "VRN", "BLQ", "NAP", "CTA", "PMO", "TRS", "AOI", "BRI", "PSR", "CAG", "FLR", "PSA", "GOA", "REG", "TAR", "PEG"],
      france: ["CDG", "ORY", "BVA", "BOD", "MRS", "LYS", "NCE", "TLS", "NTE", "SXB", "LIL", "RNS", "BIA", "PGF", "AJA", "BIQ", "BES", "FNI"],
      spain: ["MAD", "BCN", "VLC", "SVQ", "AGP", "PMI", "IBZ", "ALC", "BIO", "ZAZ", "SDR", "VGO", "GRX", "LEI", "REU", "TFS", "TFN", "LPA", "FUE", "SPC", "VDE", "ACE", "GRO", "JCU"],
      portugal: ["LIS", "OPO", "FAO", "FNC", "PDL"],
      germany: ["FRA", "MUC", "BER", "HAM", "DUS", "CGN", "HAJ", "STR", "NUE", "LEJ", "DTM", "BRE", "HHN", "FMO", "PAD", "FKB"],
      netherlands: ["AMS", "RTM", "EIN", "GRQ"],
      belgium: ["BRU", "CRL", "OST"],
      united_kingdom: ["LHR", "LGW", "STN", "LTN", "MAN", "BHX", "EDI", "GLA", "BRS", "NCL", "LPL", "BFS", "DSA", "EXT", "EMA", "BOH", "SOU", "LCY"],
      ireland: ["DUB", "ORK", "SNN", "NOC", "KIR"],
      greece: ["ATH", "SKG", "HER", "CFU", "ZTH", "RHO", "KGS", "JTR", "JMK", "JNX", "CHQ", "MJT", "KVA", "LXS", "VOL"],
      austria: ["VIE", "SZG", "INN", "GRZ", "LNZ"],
      switzerland: ["ZRH", "GVA", "BSL"],
      sweden: ["ARN", "GOT", "MMX", "LPI"],
      norway: ["OSL", "BGO", "TRD", "SVG", "TOS", "BOO"],
      denmark: ["CPH", "BLL", "AAR"],
      finland: ["HEL", "TMP", "TKU", "OUL"],
      poland: ["WAW", "KRK", "GDN", "WRO", "KTW", "POZ", "RZE", "SZZ", "BZG", "LUZ"],
      czechia: ["PRG", "BRQ"],
      hungary: ["BUD", "DEB"],
      romania: ["OTP", "CLJ", "TSR", "IAS", "OMR", "SBZ"],
      bulgaria: ["SOF", "VAR", "BOJ", "PDV"],
      croatia: ["ZAG", "SPU", "DBV", "PUY", "ZAD", "RJK", "BWK"],
      slovenia: ["LJU"],
      slovakia: ["BTS", "KSC"],
      serbia: ["BEG", "INI"],
      montenegro: ["TGD", "TIV"],
      north_macedonia: ["SKP"],
      albania: ["TIA"],
      bosnia: ["SJJ", "OMO"],
      lithuania: ["VNO", "KUN", "PLQ"],
      latvia: ["RIX"],
      estonia: ["TLL"],
      iceland: ["KEF"],
      cyprus: ["LCA", "PFO"],
      malta_only: ["MLA"],
      morocco: ["CMN", "RAK", "AGA", "FEZ", "OUD", "TNG", "NDR", "TTU"],
      tunisia: ["TUN", "MIR", "DJE", "SFA"],
      egypt: ["CAI", "HRG", "SSH", "LXR", "ASW", "ALY"],
      turkey: ["IST", "SAW", "AYT", "ADB", "ESB", "ADA", "DLM", "BJV", "GZT", "TZX", "SZF"]
    };
    COUNTRY_NAMES = {
      italy: "Italy",
      france: "France",
      spain: "Spain",
      portugal: "Portugal",
      germany: "Germany",
      netherlands: "Netherlands",
      belgium: "Belgium",
      united_kingdom: "United Kingdom",
      ireland: "Ireland",
      greece: "Greece",
      austria: "Austria",
      switzerland: "Switzerland",
      sweden: "Sweden",
      norway: "Norway",
      denmark: "Denmark",
      finland: "Finland",
      poland: "Poland",
      czechia: "Czech Republic",
      hungary: "Hungary",
      romania: "Romania",
      bulgaria: "Bulgaria",
      croatia: "Croatia",
      slovenia: "Slovenia",
      slovakia: "Slovakia",
      serbia: "Serbia",
      montenegro: "Montenegro",
      north_macedonia: "North Macedonia",
      albania: "Albania",
      bosnia: "Bosnia",
      lithuania: "Lithuania",
      latvia: "Latvia",
      estonia: "Estonia",
      iceland: "Iceland",
      cyprus: "Cyprus",
      malta: "Malta",
      morocco: "Morocco",
      tunisia: "Tunisia",
      egypt: "Egypt",
      turkey: "Turkey"
    };
  }
});

// src/db/fare-finder.ts
var fare_finder_exports = {};
__export(fare_finder_exports, {
  buildToolHints: () => buildToolHints,
  findBestOneWay: () => findBestOneWay,
  findBestRoundTrip: () => findBestRoundTrip,
  findCheapestDates: () => findCheapestDates,
  findCheapestDestinations: () => findCheapestDestinations,
  findCheapestFromAnyOrigin: () => findCheapestFromAnyOrigin,
  findWeekendDeals: () => findWeekendDeals,
  getDatasetFreshness: () => getDatasetFreshness,
  topNByPrice: () => topNByPrice
});
async function findCheapestDestinations(q) {
  const ch = getClickHouse();
  const origin = q.origin.toUpperCase();
  const limit = Math.max(1, Math.min(50, q.limit ?? 12));
  const airlineCode = (q.airlineCode ?? "").toUpperCase();
  const airlineName = q.airline ?? "";
  const maxPrice = typeof q.maxPrice === "number" && q.maxPrice > 0 ? q.maxPrice : 0;
  const useMaxPrice = maxPrice > 0;
  const queryParams = {
    origin,
    dateFrom: q.dateFrom,
    dateTo: q.dateTo,
    airlineCode,
    airlineName,
    maxPrice,
    useMaxPrice: useMaxPrice ? 1 : 0,
    limit
  };
  const r = await ch.query({
    query: `
      SELECT
        destination_iata AS iata,
        min(price) AS best_price,
        any(currency) AS currency,
        argMin(departure_date, price) AS best_date,
        any(airline) AS best_airline,
        count() AS n_flights,
        uniqExact(departure_date) AS n_dates
      FROM flight_listings_latest
      WHERE origin_iata = {origin:String}
        AND departure_date BETWEEN {dateFrom:Date} AND {dateTo:Date}
        AND price > 0
        AND ({airlineCode:String} = '' OR airline_code = {airlineCode:String})
        AND ({airlineName:String} = '' OR airline = {airlineName:String})
        AND ({useMaxPrice:UInt8} = 0 OR price <= {maxPrice:UInt32})
      GROUP BY destination_iata
      ORDER BY best_price ASC, n_dates DESC
      LIMIT {limit:UInt32}
    `,
    query_params: queryParams,
    format: "JSONEachRow"
  });
  const rows = await r.json();
  return rows.map((row) => {
    const iata = String(row.iata ?? "").toUpperCase();
    const ap = getAirport(iata);
    return {
      iata,
      bestPrice: Number(row.best_price ?? 0),
      currency: String(row.currency ?? "EUR"),
      bestDate: String(row.best_date ?? "").slice(0, 10),
      bestAirline: String(row.best_airline ?? ""),
      nFlights: Number(row.n_flights ?? 0),
      nDates: Number(row.n_dates ?? 0),
      city: ap?.city ?? null,
      country: ap?.country ?? null
    };
  });
}
async function findCheapestDates(q) {
  const ch = getClickHouse();
  const origin = q.origin.toUpperCase();
  const destination = q.destination.toUpperCase();
  const limit = Math.max(1, Math.min(120, q.limit ?? 60));
  const airlineCode = (q.airlineCode ?? "").toUpperCase();
  const airlineName = q.airline ?? "";
  const maxPrice = typeof q.maxPrice === "number" && q.maxPrice > 0 ? q.maxPrice : 0;
  const useMaxPrice = maxPrice > 0;
  const r = await ch.query({
    query: `
      SELECT
        departure_date AS d,
        min(price) AS best_price,
        any(currency) AS currency,
        any(airline) AS best_airline,
        count() AS flights,
        argMin(departure_datetime, price) AS best_dt,
        any(duration_minutes) AS duration_minutes
      FROM flight_listings_latest
      WHERE origin_iata = {origin:String}
        AND destination_iata = {destination:String}
        AND departure_date BETWEEN {dateFrom:Date} AND {dateTo:Date}
        AND price > 0
        AND ({airlineCode:String} = '' OR airline_code = {airlineCode:String})
        AND ({airlineName:String} = '' OR airline = {airlineName:String})
        AND ({useMaxPrice:UInt8} = 0 OR price <= {maxPrice:UInt32})
      GROUP BY departure_date
      ORDER BY departure_date ASC
      LIMIT {limit:UInt32}
    `,
    query_params: {
      origin,
      destination,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      airlineCode,
      airlineName,
      maxPrice,
      useMaxPrice: useMaxPrice ? 1 : 0,
      limit
    },
    format: "JSONEachRow"
  });
  const rows = await r.json();
  return rows.map((row) => ({
    date: String(row.d ?? "").slice(0, 10),
    bestPrice: Number(row.best_price ?? 0),
    currency: String(row.currency ?? "EUR"),
    bestAirline: String(row.best_airline ?? ""),
    flights: Number(row.flights ?? 0),
    cheapestDepartureDatetime: row.best_dt ? String(row.best_dt).slice(0, 19) : null,
    durationMinutes: row.duration_minutes != null ? Number(row.duration_minutes) : null
  }));
}
async function findBestRoundTrip(q) {
  const ch = getClickHouse();
  const origin = q.origin.toUpperCase();
  const destination = q.destination.toUpperCase();
  const minDays = Math.max(1, Math.min(60, q.minDays ?? 3));
  const maxDays = Math.max(minDays, Math.min(60, q.maxDays ?? 14));
  const limit = Math.max(1, Math.min(50, q.limit ?? 5));
  const airlineCode = (q.airlineCode ?? "").toUpperCase();
  const useAirline = airlineCode.length > 0 ? 1 : 0;
  const r = await ch.query({
    query: `
      WITH
        toUInt8({useAirline:UInt8}) AS use_airline,
        toString({airlineCode:String}) AS airline_filter,
        toUInt32({minDays:UInt32}) AS min_days,
        toUInt32({maxDays:UInt32}) AS max_days
      SELECT
        o.departure_date        AS outbound_date,
        argMin(o.departure_datetime, o.price) AS outbound_dt,
        argMin(o.airline, o.price) AS outbound_airline,
        argMin(o.price, o.price) AS outbound_price,
        r.departure_date        AS return_date,
        argMin(r.departure_datetime, r.price) AS return_dt,
        argMin(r.airline, r.price) AS return_airline,
        argMin(r.price, r.price) AS return_price,
        argMin(o.price, o.price) + argMin(r.price, r.price) AS total_price,
        argMin(o.currency, o.price) AS currency,
        dateDiff('day', o.departure_date, r.departure_date) AS trip_days
      FROM flight_listings_latest o
      INNER JOIN flight_listings_latest r
        ON r.origin_iata    = o.destination_iata
       AND r.destination_iata = o.origin_iata
       AND r.departure_date > o.departure_date
       AND dateDiff('day', o.departure_date, r.departure_date) BETWEEN min_days AND max_days
      WHERE o.origin_iata = {origin:String}
        AND o.destination_iata = {destination:String}
        AND r.origin_iata = {destination:String}
        AND r.destination_iata = {origin:String}
        AND o.departure_date BETWEEN {dateFrom:Date} AND {dateTo:Date}
        AND r.departure_date BETWEEN {dateFrom:Date} AND {dateTo:Date}
        AND o.price > 0 AND r.price > 0
        AND (use_airline = 0 OR (o.airline_code = airline_filter AND r.airline_code = airline_filter))
      GROUP BY o.departure_date, r.departure_date
      ORDER BY total_price ASC, trip_days ASC, outbound_date ASC
      LIMIT {limit:UInt32}
    `,
    query_params: {
      origin,
      destination,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      minDays,
      maxDays,
      limit,
      airlineCode,
      useAirline
    },
    format: "JSONEachRow"
  });
  const rows = await r.json();
  return rows.map((row) => ({
    origin,
    destination,
    outboundDate: String(row.outbound_date ?? "").slice(0, 10),
    outboundDepartureDatetime: row.outbound_dt ? String(row.outbound_dt).slice(0, 19) : null,
    outboundAirline: String(row.outbound_airline ?? ""),
    outboundPrice: Number(row.outbound_price ?? 0),
    returnDate: String(row.return_date ?? "").slice(0, 10),
    returnDepartureDatetime: row.return_dt ? String(row.return_dt).slice(0, 19) : null,
    returnAirline: String(row.return_airline ?? ""),
    returnPrice: Number(row.return_price ?? 0),
    totalPrice: Number(row.total_price ?? 0),
    currency: String(row.currency ?? "EUR"),
    tripDays: Number(row.trip_days ?? 0)
  }));
}
async function findBestOneWay(q) {
  const ch = getClickHouse();
  const origin = q.origin.toUpperCase();
  const destination = q.destination.toUpperCase();
  const limit = Math.max(1, Math.min(60, q.limit ?? 10));
  const airlineCode = (q.airlineCode ?? "").toUpperCase();
  const useAirline = airlineCode.length > 0 ? 1 : 0;
  const r = await ch.query({
    query: `
      SELECT
        departure_date AS d,
        min(price) AS best_price,
        any(currency) AS currency,
        any(airline) AS best_airline,
        argMin(departure_datetime, price) AS best_dt,
        any(duration_minutes) AS duration_minutes
      FROM flight_listings_latest
      WHERE origin_iata = {origin:String}
        AND destination_iata = {destination:String}
        AND departure_date BETWEEN {dateFrom:Date} AND {dateTo:Date}
        AND price > 0
        AND ({useAirline:UInt8} = 0 OR airline_code = {airlineCode:String})
      GROUP BY departure_date
      ORDER BY best_price ASC
      LIMIT {limit:UInt32}
    `,
    query_params: {
      origin,
      destination,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      airlineCode,
      useAirline,
      limit
    },
    format: "JSONEachRow"
  });
  const rows = await r.json();
  return rows.map((row) => ({
    origin,
    destination,
    date: String(row.d ?? "").slice(0, 10),
    price: Number(row.best_price ?? 0),
    currency: String(row.currency ?? "EUR"),
    airline: String(row.best_airline ?? ""),
    departureDatetime: row.best_dt ? String(row.best_dt).slice(0, 19) : null,
    durationMinutes: row.duration_minutes != null ? Number(row.duration_minutes) : null
  }));
}
async function findCheapestFromAnyOrigin(q) {
  const ch = getClickHouse();
  const origins = Array.from(new Set(q.origins.map((o) => o.toUpperCase())));
  if (origins.length === 0) return [];
  const limit = Math.max(1, Math.min(50, q.limit ?? 10));
  const dest = (q.destination ?? "").toUpperCase();
  const r = await ch.query({
    query: `
      SELECT
        origin_iata,
        destination_iata,
        min(price) AS best_price,
        any(currency) AS currency,
        argMin(departure_date, price) AS best_date,
        any(airline) AS best_airline
      FROM flight_listings_latest
      WHERE origin_iata IN {origins:Array(String)}
        AND ({destination:String} = '' OR destination_iata = {destination:String})
        AND departure_date BETWEEN {dateFrom:Date} AND {dateTo:Date}
        AND price > 0
      GROUP BY origin_iata, destination_iata
    `,
    query_params: {
      origins,
      destination: dest,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo
    },
    format: "JSONEachRow"
  });
  const rows = await r.json();
  const grouped = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const o = String(row.origin_iata ?? "").toUpperCase();
    const d = String(row.destination_iata ?? "").toUpperCase();
    const price = Number(row.best_price ?? 0);
    if (!grouped.has(d)) {
      const ap = getAirport(d);
      grouped.set(d, {
        bestOrigin: o,
        destination: d,
        bestPrice: price,
        currency: String(row.currency ?? "EUR"),
        bestDate: String(row.best_date ?? "").slice(0, 10),
        bestAirline: String(row.best_airline ?? ""),
        alternativeOrigins: [],
        city: ap?.city ?? null,
        country: ap?.country ?? null
      });
    }
    const cur = grouped.get(d);
    cur.alternativeOrigins.push({
      origin: o,
      price,
      date: String(row.best_date ?? "").slice(0, 10)
    });
    if (price < cur.bestPrice) {
      cur.bestPrice = price;
      cur.bestOrigin = o;
      cur.bestDate = String(row.best_date ?? "").slice(0, 10);
      cur.bestAirline = String(row.best_airline ?? "");
    }
  }
  for (const deal of grouped.values()) {
    deal.alternativeOrigins.sort((a, b) => a.price - b.price);
  }
  return Array.from(grouped.values()).sort((a, b) => a.bestPrice - b.bestPrice).slice(0, limit);
}
async function findWeekendDeals(q) {
  const ch = getClickHouse();
  const origin = q.origin.toUpperCase();
  const destination = q.destination.toUpperCase();
  const nights = Math.max(1, Math.min(21, q.nightCount ?? 4));
  const limit = Math.max(1, Math.min(20, q.limit ?? 5));
  const airlineCode = (q.airlineCode ?? "").toUpperCase();
  const useAirline = airlineCode.length > 0 ? 1 : 0;
  const r = await ch.query({
    query: `
      WITH
        toUInt8({useAirline:UInt8}) AS use_airline,
        toString({airlineCode:String}) AS airline_filter,
        toUInt32({nights:UInt32}) AS nights
      SELECT
        o.departure_date  AS outbound_date,
        argMin(o.departure_datetime, o.price) AS outbound_dt,
        argMin(o.airline, o.price)   AS outbound_airline,
        argMin(o.price, o.price)     AS outbound_price,
        r.departure_date  AS return_date,
        argMin(r.departure_datetime, r.price) AS return_dt,
        argMin(r.airline, r.price)   AS return_airline,
        argMin(r.price, r.price)     AS return_price,
        argMin(o.price, o.price) + argMin(r.price, r.price) AS total_price,
        argMin(o.currency, o.price)  AS currency
      FROM flight_listings_latest o
      INNER JOIN flight_listings_latest r
        ON r.origin_iata      = o.destination_iata
       AND r.destination_iata = o.origin_iata
       AND r.departure_date > o.departure_date
       AND dateDiff('day', o.departure_date, r.departure_date) BETWEEN nights AND nights + 2
      WHERE o.origin_iata = {origin:String}
        AND o.destination_iata = {destination:String}
        AND r.origin_iata = {destination:String}
        AND r.destination_iata = {origin:String}
        AND o.departure_date BETWEEN {dateFrom:Date} AND {dateTo:Date}
        AND r.departure_date BETWEEN {dateFrom:Date} AND {dateTo:Date}
        AND o.price > 0 AND r.price > 0
        AND toDayOfWeek(o.departure_date) IN (5, 6, 7)
        AND toDayOfWeek(r.departure_date) IN (5, 6, 7)
        AND (use_airline = 0 OR (o.airline_code = airline_filter AND r.airline_code = airline_filter))
      GROUP BY o.departure_date, r.departure_date
      ORDER BY total_price ASC, outbound_date ASC
      LIMIT {limit:UInt32}
    `,
    query_params: {
      origin,
      destination,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      nights,
      limit,
      airlineCode,
      useAirline
    },
    format: "JSONEachRow"
  });
  const rows = await r.json();
  return rows.map((row) => {
    const outboundDate = String(row.outbound_date ?? "").slice(0, 10);
    const returnDate = String(row.return_date ?? "").slice(0, 10);
    const tripDays = Math.round(
      ((/* @__PURE__ */ new Date(returnDate + "T00:00:00Z")).getTime() - (/* @__PURE__ */ new Date(outboundDate + "T00:00:00Z")).getTime()) / 864e5
    );
    return {
      origin,
      destination,
      outboundDate,
      returnDate,
      outboundPrice: Number(row.outbound_price ?? 0),
      returnPrice: Number(row.return_price ?? 0),
      totalPrice: Number(row.total_price ?? 0),
      currency: String(row.currency ?? "EUR"),
      outboundAirline: String(row.outbound_airline ?? ""),
      returnAirline: String(row.return_airline ?? ""),
      nights: Math.max(0, tripDays - 1)
    };
  });
}
async function getDatasetFreshness() {
  const ch = getClickHouse();
  const r = await ch.query({
    query: `
      SELECT
        airline,
        max(latest_observed_at) AS max_observed_at,
        count() AS rows,
        uniqExact((origin_iata, destination_iata)) AS routes
      FROM flight_listings_latest
      GROUP BY airline
    `,
    format: "JSONEachRow"
  });
  const a = await r.json();
  const r2 = await ch.query({
    query: `
      SELECT
        concat(origin_iata, '\u2192', destination_iata) AS route,
        max(latest_observed_at) AS max_observed_at,
        uniqExact(departure_date) AS distinct_dates
      FROM flight_listings_latest
      GROUP BY route
      ORDER BY max_observed_at DESC
      LIMIT 50
    `,
    format: "JSONEachRow"
  });
  const rr = await r2.json();
  const byAirlineRoutes = rr.map((row) => ({
    route: String(row.route ?? ""),
    maxObservedAt: String(row.max_observed_at ?? ""),
    distinctDates: Number(row.distinct_dates ?? 0)
  }));
  let overallMax = null;
  let overallRows = 0;
  const byAirline = a.map((row) => {
    const maxObs = String(row.max_observed_at ?? "");
    if (!overallMax || maxObs > overallMax) overallMax = maxObs;
    overallRows += Number(row.rows ?? 0);
    return {
      airline: String(row.airline ?? ""),
      maxObservedAt: maxObs,
      rows: Number(row.rows ?? 0),
      routes: Number(row.routes ?? 0)
    };
  });
  return { byAirline, byAirlineRoutes, overallMax, overallRows };
}
function buildToolHints(result) {
  const warnings = [];
  if (!result.overallMax) warnings.push("No flight data available \u2014 recommend refreshing the crawl.");
  else {
    const ageMs = Date.now() - new Date(result.overallMax).getTime();
    const ageHours = ageMs / 36e5;
    if (ageHours > 168) warnings.push(`Data is ${Math.round(ageHours / 24)} days stale \u2014 recommend refreshing before quoting prices.`);
    else if (ageHours > 48) warnings.push(`Data is ${Math.round(ageHours)} hours old \u2014 within freshness SLA but quote with observed_at if precision matters.`);
  }
  if (result.overallRows < 100) warnings.push(`Only ${result.overallRows} fares loaded \u2014 coverage is thin.`);
  return {
    freshness: {
      overallMaxObservedAt: result.overallMax,
      overallRows: result.overallRows,
      byAirline: result.byAirline.map((a) => ({
        airline: a.airline,
        rows: a.rows,
        maxObservedAt: a.maxObservedAt
      }))
    },
    warnings
  };
}
function topNByPrice(items, n) {
  return [...items].sort((a, b) => {
    const pa = Number(a.bestPrice ?? a.totalPrice ?? 0);
    const pb = Number(b.bestPrice ?? b.totalPrice ?? 0);
    return pa - pb;
  }).slice(0, n);
}
var init_fare_finder = __esm({
  "src/db/fare-finder.ts"() {
    "use strict";
    init_clickhouse();
    init_airports();
  }
});

// src/db/itinerary-planner.ts
var itinerary_planner_exports = {};
__export(itinerary_planner_exports, {
  planBestItinerary: () => planBestItinerary
});
function permute(items) {
  if (items.length <= 1) return [items.slice()];
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const head = items[i];
    if (head === void 0) continue;
    const rest = items.slice(0, i).concat(items.slice(i + 1));
    for (const sub of permute(rest)) out.push([head, ...sub]);
  }
  return out;
}
function buildItineraryQuery(input) {
  const home = input.home.toUpperCase();
  const stops = Array.from(new Set(input.stops.map((s) => s.toUpperCase()))).filter(
    (s) => /^[A-Z]{3}$/.test(s) && s !== home
  );
  if (stops.length < 1) throw new Error("stops must contain at least 1 airport");
  if (stops.length > 5) throw new Error(`stops supports up to 5 destinations, got ${stops.length}`);
  const n = stops.length;
  const bufferDays = Math.max(0, Math.min(30, input.bufferDays ?? 1));
  const topK = Math.max(1, Math.min(50, input.topK ?? 1));
  const maxCombinations = Math.max(
    1e6,
    Math.min(1e9, input.maxCombinations ?? DEFAULT_MAX_COMBINATIONS)
  );
  const maxPermutations = Math.max(
    0,
    Math.min(1e3, input.maxPermutations ?? DEFAULT_MAX_PERMUTATIONS)
  );
  let perms = permute(stops);
  if (maxPermutations > 0 && perms.length > maxPermutations) {
    log4.warn("permutation cap reached", {
      n,
      total: perms.length,
      kept: maxPermutations
    });
    perms = perms.slice(0, maxPermutations);
  }
  const legCount = n + 1;
  const autoCandidates = Math.max(
    1,
    Math.floor(Math.pow(maxCombinations / Math.max(1, perms.length), 1 / legCount))
  );
  const maxCandidatesPerLeg = Math.max(
    1,
    Math.min(500, Math.min(autoCandidates, input.maxCandidatesPerLeg ?? DEFAULT_MAX_CANDIDATES_PER_LEG))
  );
  log4.info("itinerary planner sizing", {
    n,
    perms: perms.length,
    legCount,
    maxCandidatesPerLeg,
    autoCandidates,
    estCombinations: perms.length * Math.pow(maxCandidatesPerLeg, legCount),
    maxCombinations
  });
  const permsLiteral = `[${perms.map((p) => `[${p.map((s) => `'${s.replace(/'/g, "''")}'`).join(",")}]`).join(",")}]`;
  const params = {
    home,
    bufferDays,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    topK,
    maxCandidatesPerLeg
  };
  const airlineFilter = input.preferredAirlines && input.preferredAirlines.length > 0 ? "AND f.airline_code IN {preferredAirlines:Array(String)}" : "";
  if (airlineFilter) params.preferredAirlines = input.preferredAirlines;
  const selectParts = [];
  const legCtes = [];
  const joinParts = [];
  for (let i = 0; i <= n; i++) {
    const alias = `l${i}`;
    selectParts.push(
      `${alias}.origin_iata AS l${i}_origin`,
      `${alias}.destination_iata AS l${i}_dest`,
      `${alias}.departure_date AS l${i}_date`,
      `${alias}.departure_datetime AS l${i}_dep`,
      `${alias}.arrival_datetime AS l${i}_arr`,
      `${alias}.price AS l${i}_price`,
      `${alias}.currency AS l${i}_currency`,
      `${alias}.airline AS l${i}_airline`,
      `${alias}.duration_minutes AS l${i}_dur`
    );
    legCtes.push(`${alias} AS (SELECT * FROM pruned WHERE leg_idx = ${i})`);
  }
  const totalExpr = Array.from({ length: n + 1 }, (_, i) => `l${i}.price`).join(" + ");
  for (let i = 1; i <= n; i++) {
    const prev = `l${i - 1}`;
    const next = `l${i}`;
    const isReturnLeg = i === n;
    const constraint = isReturnLeg ? `${next}.departure_datetime >= ${prev}.arrival_datetime` : `${next}.departure_datetime >= ${prev}.arrival_datetime + INTERVAL {bufferDays:UInt32} DAY`;
    joinParts.push(
      `INNER JOIN ${next} ON ${next}.perm_id = ${prev}.perm_id AND ${constraint}`
    );
  }
  const prunedSubquery = `
SELECT *
FROM (
  SELECT
    pl.perm_id,
    pl.leg_idx,
    pl.origin_iata,
    pl.destination_iata,
    f.departure_date,
    any(f.departure_datetime) AS departure_datetime,
    any(f.arrival_datetime) AS arrival_datetime,
    min(f.price) AS price,
    any(f.currency) AS currency,
    any(f.airline) AS airline,
    any(f.duration_minutes) AS duration_minutes
  FROM (
    SELECT
      perm_id,
      leg_idx,
      if(leg_idx = 0, {home:String}, perm[leg_idx]) AS origin_iata,
      if(leg_idx = ${n}, {home:String}, perm[leg_idx + 1]) AS destination_iata
    FROM (
      SELECT
        perm,
        rowNumberInAllBlocks() AS perm_id
      FROM (SELECT arrayJoin(${permsLiteral}) AS perm) AS arr
    )
    ARRAY JOIN range(${n} + 1) AS leg_idx
  ) pl
  INNER JOIN flight_listings f
    ON f.origin_iata = pl.origin_iata
   AND f.destination_iata = pl.destination_iata
   AND f.departure_date BETWEEN {dateFrom:Date} AND {dateTo:Date}
   ${airlineFilter}
  GROUP BY pl.perm_id, pl.leg_idx, pl.origin_iata, pl.destination_iata, f.departure_date
)
ORDER BY price ASC
LIMIT {maxCandidatesPerLeg:UInt32} BY perm_id, leg_idx
`.replace(/\s+/g, " ").trim();
  const legSource = (idx) => `(SELECT * FROM (${prunedSubquery}) WHERE leg_idx = ${idx}) AS l${idx}`;
  const fromClause = `${legSource(0)}`;
  const joinClauses = joinParts.map((jp) => {
    const match = jp.match(/INNER JOIN (l\d+)/);
    const alias = match?.[1] ?? "";
    const idx = parseInt(alias.slice(1), 10);
    return jp.replace(alias, legSource(idx));
  });
  const query = `
SELECT
  ${selectParts.join(",\n  ")},
  ${totalExpr} AS total_price,
  l0.currency AS trip_currency
FROM ${fromClause}
${joinClauses.join("\n")}
ORDER BY total_price ASC
LIMIT {topK:UInt32}
`.trim();
  return { query, params };
}
function rowToLeg(row, idx) {
  const n = idx;
  const departureDatetime = String(row[`l${n}_dep`] ?? "");
  const arrivalDatetime = String(row[`l${n}_arr`] ?? "");
  const dateRaw = row[`l${n}_date`];
  const dateStr = dateRaw instanceof Date ? dateRaw.toISOString().slice(0, 10) : String(dateRaw ?? "").slice(0, 10);
  const durRaw = row[`l${n}_dur`];
  let durationMinutes = durRaw != null ? Number(durRaw) : null;
  if (durationMinutes == null && departureDatetime && arrivalDatetime) {
    const dep = (/* @__PURE__ */ new Date(departureDatetime.replace(" ", "T") + "Z")).getTime();
    const arr = (/* @__PURE__ */ new Date(arrivalDatetime.replace(" ", "T") + "Z")).getTime();
    if (Number.isFinite(dep) && Number.isFinite(arr) && arr > dep) {
      durationMinutes = Math.round((arr - dep) / 6e4);
    }
  }
  return {
    origin: String(row[`l${n}_origin`] ?? ""),
    destination: String(row[`l${n}_dest`] ?? ""),
    departureDatetime,
    arrivalDatetime,
    date: dateStr,
    price: Number(row[`l${n}_price`] ?? 0),
    currency: String(row[`l${n}_currency`] ?? "EUR"),
    airline: String(row[`l${n}_airline`] ?? ""),
    durationMinutes
  };
}
function rowToItinerary(row, legCount) {
  const legs = [];
  let totalDuration = 0;
  let durationKnown = true;
  const permutation = [];
  for (let i = 0; i < legCount; i++) {
    const leg = rowToLeg(row, i);
    legs.push(leg);
    if (i > 0 && i < legCount - 1) permutation.push(leg.origin);
    if (leg.durationMinutes != null) totalDuration += leg.durationMinutes;
    else durationKnown = false;
  }
  return {
    legs,
    totalPrice: Number(row.total_price ?? 0),
    currency: String(row.trip_currency ?? legs[0]?.currency ?? "EUR"),
    permutation,
    totalDurationMinutes: durationKnown ? totalDuration : null
  };
}
async function planBestItinerary(input) {
  const { query, params } = buildItineraryQuery(input);
  if (process.env.DEBUG_ITINERARY_SQL) {
    console.log("\n--- SQL ---\n" + query + "\n--- /SQL ---");
    console.log("params:", JSON.stringify(params));
  }
  const ch = getClickHouse();
  const startedAt = Date.now();
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 9e4);
  let rows;
  try {
    const r = await ch.query({
      query,
      query_params: params,
      format: "JSONEachRow",
      abort_signal: ac.signal
    });
    rows = await r.json();
  } finally {
    clearTimeout(t);
  }
  log4.info("itinerary planner SQL", {
    home: input.home,
    stops: input.stops,
    rows: rows.length,
    ms: Date.now() - startedAt
  });
  const legCount = Array.from(new Set(input.stops.map((s) => s.toUpperCase()))).filter((s) => /^[A-Z]{3}$/.test(s) && s !== input.home.toUpperCase()).length + 1;
  return rows.map((row) => rowToItinerary(row, legCount));
}
var log4, DEFAULT_MAX_CANDIDATES_PER_LEG, DEFAULT_MAX_PERMUTATIONS, DEFAULT_MAX_COMBINATIONS;
var init_itinerary_planner = __esm({
  "src/db/itinerary-planner.ts"() {
    "use strict";
    init_clickhouse();
    init_logger();
    log4 = logger("src/db/itinerary-planner.ts");
    DEFAULT_MAX_CANDIDATES_PER_LEG = 30;
    DEFAULT_MAX_PERMUTATIONS = 50;
    DEFAULT_MAX_COMBINATIONS = 5e7;
  }
});

// src/db/itinerary.ts
var itinerary_exports = {};
__export(itinerary_exports, {
  generateItineraries: () => generateItineraries,
  listFavorites: () => listFavorites,
  removeFavorite: () => removeFavorite,
  saveFavorite: () => saveFavorite
});
import { randomUUID } from "node:crypto";
function pickHomeAirport(homeIata) {
  const all = listAllAirports();
  return all.find((a) => a.iata === homeIata.toUpperCase()) ?? null;
}
function pickCountryAirport(country) {
  const iatas = airportsForCountry(country);
  if (iatas.length === 0) return null;
  return iatas[0] ?? null;
}
function addDays(iso, days) {
  const d = /* @__PURE__ */ new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function distributeDates(totalDays, segments, start) {
  const out = [];
  const per = Math.max(1, Math.floor(totalDays / Math.max(1, segments + 1)));
  for (let i = 0; i < segments; i++) {
    out.push(addDays(start, per * (i + 1)));
  }
  return out;
}
async function generateItineraries(req) {
  const daysPerCountry = Math.max(1, Math.min(30, req.daysPerCountry ?? 3));
  const maxItineraries = Math.max(1, Math.min(8, req.maxItineraries ?? 4));
  const homeIata = req.homeIata.toUpperCase();
  const explicit = (req.destinations ?? []).map((s) => s.toUpperCase()).filter((s) => /^[A-Z]{3}$/.test(s));
  const explicitUnique = Array.from(new Set(explicit)).filter((d) => d !== homeIata);
  let stops = [];
  let promptNote = "";
  let stopCountries = [];
  if (explicitUnique.length > 0) {
    stops = explicitUnique.map((iata) => ({ country: iata, airport: iata }));
    stopCountries = explicitUnique;
  } else {
    const detected = detectCountriesFromPrompt(req.prompt ?? "");
    if (detected.length === 0) {
      return [
        {
          id: randomUUID(),
          title: "No destinations",
          totalPrice: 0,
          currency: "EUR",
          totalDurationMinutes: null,
          legs: [],
          summary: "Pick some airports on the map or describe your trip in the chat (e.g. 'France, Spain, Italy').",
          recommendationScore: 0
        }
      ];
    }
    for (const country of detected) {
      const ap = pickCountryAirport(country);
      if (ap) stops.push({ country, airport: ap });
    }
    if (stops.length === 0) {
      return [
        {
          id: randomUUID(),
          title: "No airports found",
          totalPrice: 0,
          currency: "EUR",
          totalDurationMinutes: null,
          legs: [],
          summary: `I found the countries (${detected.join(", ")}) but couldn't match them to known airports.`,
          recommendationScore: 0
        }
      ];
    }
    stopCountries = detected;
    promptNote = `Detected countries: ${detected.join(", ")}. `;
  }
  const home = pickHomeAirport(homeIata);
  if (!home) {
    return [
      {
        id: randomUUID(),
        title: `Unknown home airport ${homeIata}`,
        totalPrice: 0,
        currency: "EUR",
        totalDurationMinutes: null,
        legs: [],
        summary: `Home IATA ${homeIata} was not found in the airport dataset.`,
        recommendationScore: 0
      }
    ];
  }
  if (stops.length > 6) {
    stops = stops.slice(0, 6);
    promptNote += `Capped at 6 destinations (you picked ${explicitUnique.length}). `;
  }
  const sequences = permute2(stops.map((s) => s.airport)).slice(0, maxItineraries);
  const allPairs = [];
  for (const seq of sequences) {
    const path = [homeIata, ...seq, homeIata];
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      if (!a || !b) continue;
      allPairs.push({ origin: a, destination: b });
    }
  }
  const cheapest = await findCheapestRoutesBetween(
    allPairs,
    req.dateFrom,
    req.dateTo,
    req.preferredAirlines ?? []
  );
  const totalDays = daysBetween(req.dateFrom, req.dateTo);
  const itineraries = [];
  for (let s = 0; s < sequences.length; s++) {
    const seq = sequences[s];
    if (!seq) continue;
    const legs = [];
    const path = [homeIata, ...seq, homeIata];
    const legDates = distributeDates(totalDays, path.length - 1, req.dateFrom);
    let totalPrice = 0;
    let currency = "EUR";
    let totalDuration = 0;
    let foundLeg = false;
    for (let i = 0; i < path.length - 1; i++) {
      const origin = path[i];
      const destination = path[i + 1];
      if (!origin || !destination) continue;
      const hit = cheapest.get(`${origin}|${destination}`);
      const date = legDates[i] ?? req.dateFrom;
      if (hit) {
        legs.push({
          origin,
          destination,
          date: hit.date ?? date,
          price: hit.price,
          currency: hit.currency,
          airline: hit.airline,
          durationMinutes: hit.durationMinutes
        });
        totalPrice += hit.price;
        currency = hit.currency || currency;
        totalDuration += hit.durationMinutes ?? 0;
        foundLeg = true;
      } else {
        legs.push({
          origin,
          destination,
          date,
          price: 0,
          currency,
          airline: "\u2014",
          durationMinutes: null
        });
      }
    }
    const score = scoreItinerary(legs, foundLeg, stops.length, req.preferredAirlines ?? []);
    itineraries.push({
      id: randomUUID(),
      title: itineraryTitle(seq, stops),
      totalPrice: round2(totalPrice),
      currency,
      totalDurationMinutes: totalDuration > 0 ? totalDuration : null,
      legs,
      summary: itinerarySummary(legs, foundLeg, stopCountries, daysPerCountry, promptNote),
      recommendationScore: score
    });
  }
  itineraries.sort((a, b) => {
    const aComplete = a.legs.every((l) => l.price > 0);
    const bComplete = b.legs.every((l) => l.price > 0);
    if (aComplete !== bComplete) return aComplete ? -1 : 1;
    return a.totalPrice - b.totalPrice;
  });
  log5.info("Generated itineraries", { count: itineraries.length, countries: stopCountries });
  return itineraries;
}
function itineraryTitle(seq, stops) {
  const labels = seq.map((iata) => {
    const stop = stops.find((s) => s.airport === iata);
    return stop ? stop.country : iata;
  });
  return labels.join(" \u2192 ");
}
function itinerarySummary(legs, foundLeg, countries, days, note) {
  const missing = legs.filter((l) => l.price === 0).map((l) => `${l.origin}\u2192${l.destination}`);
  const covered = countries.filter(() => foundLeg);
  const prefix = note ? `${note}` : "";
  if (missing.length === 0) {
    return `${prefix}Found pricing for ${legs.length} legs across ${covered.length} stop${covered.length === 1 ? "" : "s"}, ~${days} days each.`;
  }
  return `${prefix}Found pricing for ${legs.length - missing.length}/${legs.length} legs. Missing data: ${missing.join(", ")}. Try expanding the date range or request a crawl.`;
}
function scoreItinerary(legs, foundLeg, countries, preferred) {
  let score = 0;
  const pricedLegs = legs.filter((l) => l.price > 0).length;
  score += pricedLegs / Math.max(1, legs.length) * 60;
  score += Math.min(40, countries * 8);
  if (preferred.length > 0) {
    const matched = legs.filter((l) => preferred.includes(l.airline)).length;
    score += matched / Math.max(1, legs.length) * 20;
  }
  if (!foundLeg) score = 0;
  return Math.round(score);
}
function permute2(items) {
  if (items.length <= 1) return [items.slice()];
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const head = items[i];
    if (head === void 0) continue;
    const rest = items.slice(0, i).concat(items.slice(i + 1));
    for (const sub of permute2(rest)) {
      out.push([head, ...sub]);
    }
  }
  return out;
}
function daysBetween(a, b) {
  const d1 = (/* @__PURE__ */ new Date(a + "T00:00:00Z")).getTime();
  const d2 = (/* @__PURE__ */ new Date(b + "T00:00:00Z")).getTime();
  return Math.max(1, Math.round((d2 - d1) / 864e5));
}
function round2(n) {
  return Math.round(n * 100) / 100;
}
function listFavorites() {
  return FAVORITES.slice().sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
function saveFavorite(it) {
  const fav = {
    id: randomUUID(),
    itineraryId: it.id,
    title: it.title,
    totalPrice: it.totalPrice,
    currency: it.currency,
    legs: it.legs,
    savedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  FAVORITES.unshift(fav);
  return fav;
}
function removeFavorite(id) {
  const idx = FAVORITES.findIndex((f) => f.id === id);
  if (idx === -1) return false;
  FAVORITES.splice(idx, 1);
  return true;
}
var log5, FAVORITES;
var init_itinerary = __esm({
  "src/db/itinerary.ts"() {
    "use strict";
    init_airports();
    init_logger();
    log5 = logger("src/db/itinerary.ts");
    FAVORITES = [];
  }
});

// src/trigger/tools/registry.ts
var registry_exports = {};
__export(registry_exports, {
  ToolAirportFares: () => ToolAirportFares,
  ToolBestOneWay: () => ToolBestOneWay,
  ToolBestRoundTrip: () => ToolBestRoundTrip,
  ToolCheapestDates: () => ToolCheapestDates,
  ToolCheapestDestinations: () => ToolCheapestDestinations,
  ToolCheapestFromAny: () => ToolCheapestFromAny,
  ToolDatasetFreshness: () => ToolDatasetFreshness,
  ToolListFavorites: () => ToolListFavorites,
  ToolMultiStop: () => ToolMultiStop,
  ToolRefreshCrawl: () => ToolRefreshCrawl,
  ToolRemoveFavorite: () => ToolRemoveFavorite,
  ToolRoundTrip: () => ToolRoundTrip,
  ToolSaveFavorite: () => ToolSaveFavorite,
  ToolSearchAirports: () => ToolSearchAirports,
  ToolWeekendDeals: () => ToolWeekendDeals,
  getTool: () => getTool,
  listTools: () => listTools
});
import { z } from "zod";
import { tasks } from "@trigger.dev/sdk";
function describeField(field) {
  const description = field.description;
  return description ? { description } : {};
}
function zodToJsonSchema(schema) {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const properties = {};
    const required = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = { ...describeField(value), ...describePrimitive(value) };
      if (!(value instanceof z.ZodOptional) && !(value instanceof z.ZodDefault)) required.push(key);
    }
    return { type: "object", properties, required };
  }
  return { type: "object", properties: {}, required: [] };
}
function describePrimitive(schema) {
  let inner = schema;
  while (inner instanceof z.ZodOptional || inner instanceof z.ZodDefault) {
    inner = inner._def.innerType;
  }
  if (inner instanceof z.ZodString) return { type: "string" };
  if (inner instanceof z.ZodNumber) return { type: "number" };
  if (inner instanceof z.ZodBoolean) return { type: "boolean" };
  if (inner instanceof z.ZodArray) {
    return { type: "array", items: describePrimitive(inner._def.type) };
  }
  if (inner instanceof z.ZodEnum) {
    return { type: "string", enum: inner._def.values };
  }
  if (inner instanceof z.ZodObject) return zodToJsonSchema(inner);
  return {};
}
function defineTool(def) {
  const parameters = zodToJsonSchema(def.schema);
  return {
    id: def.id,
    name: def.name,
    description: def.description,
    schema: def.schema,
    parameters,
    handler: def.handler
  };
}
function listTools() {
  return ALL_TOOLS;
}
function getTool(id) {
  return ALL_TOOLS.find((t) => t.id === id) ?? null;
}
var ToolSearchAirports, ToolAirportFares, ToolRoundTrip, ToolMultiStop, ToolRefreshCrawl, ToolCheapestDestinations, ToolCheapestDates, ToolBestRoundTrip, ToolBestOneWay, ToolCheapestFromAny, ToolWeekendDeals, ToolDatasetFreshness, ToolListFavorites, ToolSaveFavorite, ToolRemoveFavorite, ALL_TOOLS;
var init_registry = __esm({
  "src/trigger/tools/registry.ts"() {
    "use strict";
    init_airports();
    init_itinerary();
    init_crawl_progress();
    init_crawl();
    init_fare_finder();
    init_itinerary_planner();
    ToolSearchAirports = defineTool({
      id: "tool-search-airports",
      name: "search_airports",
      description: "Look up airports by IATA code, city name, or country code. Returns at most 25 airports with their IATA, city, country, and lat/lon.",
      schema: z.object({
        query: z.string().min(1).describe("Free-text query: IATA code, city name, or ISO country code."),
        airline: z.string().optional().describe("Restrict to airports reachable by this airline (default Ryanair).")
      }),
      handler: async ({ query, airline }) => {
        const local = searchAirports(query, 25);
        if (local.length > 0) return { ok: true, count: local.length, airports: local };
        if (airline) {
          const rows = await listAirportsForAirline(airline);
          const q = query.toLowerCase();
          const filtered = rows.filter(
            (a) => a.iata.toLowerCase().includes(q) || (a.city || "").toLowerCase().includes(q) || (a.country || "").toLowerCase() === q
          );
          return { ok: true, count: filtered.length, airports: filtered.slice(0, 25) };
        }
        return { ok: true, count: 0, airports: [] };
      }
    });
    ToolAirportFares = defineTool({
      id: "tool-airport-fares",
      name: "get_airport_fares",
      description: "List fares originating from or arriving at an airport. Use this to inspect what's currently available before planning a trip.",
      schema: z.object({
        iata: z.string().length(3).describe("3-letter IATA airport code."),
        dateFrom: z.string().optional().describe("Filter by departure date >= YYYY-MM-DD."),
        dateTo: z.string().optional().describe("Filter by departure date <= YYYY-MM-DD."),
        limit: z.number().int().min(1).max(500).optional().describe("Max results (default 200).")
      }),
      handler: async ({ iata, dateFrom, dateTo, limit }) => {
        const fares = await listFaresForAirport({
          iata,
          dateFrom,
          dateTo,
          limit: limit ?? 200
        });
        const airport = getAirport(iata);
        return { ok: true, iata, airport, count: fares.length, fares };
      }
    });
    ToolRoundTrip = defineTool({
      id: "tool-round-trip",
      name: "plan_round_trip",
      description: "Find the cheapest round trip between an origin and a single destination. Optionally constrain the trip length in days.",
      schema: z.object({
        origin: z.string().length(3).describe("Origin IATA code."),
        destination: z.string().length(3).describe("Destination IATA code."),
        dateFrom: z.string().describe("Earliest outbound date YYYY-MM-DD."),
        dateTo: z.string().describe("Latest return date YYYY-MM-DD."),
        minDays: z.number().int().min(1).max(60).optional().describe("Minimum trip length in days."),
        maxDays: z.number().int().min(1).max(60).optional().describe("Maximum trip length in days."),
        limit: z.number().int().min(1).max(20).optional().describe("Max round-trip options to return (default 5).")
      }),
      handler: async ({ origin, destination, dateFrom, dateTo, minDays, maxDays, limit }) => {
        const trips = await findCheapestRoundTrip({
          origin,
          destination,
          dateFrom,
          dateTo,
          minDays,
          maxDays
        });
        return {
          ok: true,
          origin: origin.toUpperCase(),
          destination: destination.toUpperCase(),
          count: trips.length,
          options: trips.slice(0, limit ?? 5)
        };
      }
    });
    ToolMultiStop = defineTool({
      id: "tool-multi-stop",
      name: "plan_multi_stop",
      description: "Plan a multi-stop round trip starting and ending at `homeIata`, visiting each destination in order. Returns up to 8 permutations sorted by price. Backed by a single-click ClickHouse planner (not the legacy in-memory loop).",
      schema: z.object({
        homeIata: z.string().length(3).describe("Home airport IATA code."),
        destinations: z.array(z.string().length(3)).min(1).max(6).describe("1-6 destination IATA codes."),
        dateFrom: z.string().describe("Trip start date YYYY-MM-DD."),
        dateTo: z.string().describe("Trip end date YYYY-MM-DD."),
        daysPerCountry: z.number().int().min(1).max(30).optional().describe("Days spent at each stop."),
        maxItineraries: z.number().int().min(1).max(8).optional().describe("Top-K itineraries to return (default 4)."),
        bufferDays: z.number().int().min(0).max(7).optional().describe("Layover buffer days (default 1)."),
        preferredAirlines: z.array(z.string()).max(6).optional().describe("Restrict to airline codes (e.g. ['FR','EZY']).")
      }),
      handler: async ({ homeIata, destinations, dateFrom, dateTo, daysPerCountry, maxItineraries, bufferDays, preferredAirlines }) => {
        const result = await planBestItinerary({
          home: homeIata.toUpperCase(),
          stops: destinations.map((d) => d.toUpperCase()),
          dateFrom,
          dateTo,
          bufferDays: bufferDays ?? 1,
          topK: maxItineraries ?? 4,
          preferredAirlines
        });
        const legsFlat = result.flatMap((itin) => itin.legs);
        return {
          ok: true,
          count: result.length,
          itineraries: result.map((it) => ({
            ...it,
            legs: it.legs.map((leg) => ({
              ...leg,
              originAirport: getAirport(leg.origin),
              destinationAirport: getAirport(leg.destination)
            }))
          })),
          coverage: {
            legs: legsFlat.length
          }
        };
      }
    });
    ToolRefreshCrawl = defineTool({
      id: "tool-refresh-crawl",
      name: "trigger_refresh_crawl",
      description: "Queue a fresh crawl for one or more flight legs that are missing price data. Runs the crawl-queue-worker.",
      schema: z.object({
        legs: z.array(
          z.object({
            origin: z.string().length(3),
            destination: z.string().length(3),
            dateFrom: z.string().describe("YYYY-MM-DD"),
            dateTo: z.string().describe("YYYY-MM-DD")
          })
        ).min(1).max(50),
        airline: z.enum(["Ryanair", "EasyJet"]).optional(),
        runId: z.string().optional()
      }),
      handler: async ({ legs, airline, runId }) => {
        const a = airline ?? "Ryanair";
        const crawlRunId = runId ?? crypto.randomUUID();
        const origins = Array.from(new Set(legs.map((l) => l.origin)));
        const first = legs[0];
        if (!first) throw new Error("legs must not be empty");
        const enqueue = await enqueuePendingRoutes({
          airline: a,
          origins,
          dateFrom: first.dateFrom,
          dateTo: first.dateTo,
          crawlRunId
        });
        const handle = await tasks.trigger("crawl-queue-worker", {
          airline: a,
          crawlRunId,
          maxIterations: Math.max(enqueue.enqueued + enqueue.already_pending, 1),
          adults: CRAWL_CONFIG[a.toLowerCase()]?.adults ?? 1,
          requestDelayMs: CRAWL_CONFIG[a.toLowerCase()]?.requestDelayMs ?? 0,
          requestJitterMs: CRAWL_CONFIG[a.toLowerCase()]?.requestJitterMs ?? 0,
          cooldownMs: CRAWL_CONFIG[a.toLowerCase()]?.cooldownMs ?? 0
        });
        return {
          ok: true,
          crawlRunId,
          airline: a,
          runId: handle.id,
          task: "crawl-queue-worker",
          publicAccessToken: handle.publicAccessToken,
          enqueued: enqueue.enqueued,
          alreadyPending: enqueue.already_pending,
          legsQueued: legs.length,
          legs
        };
      }
    });
    ToolCheapestDestinations = defineTool({
      id: "tool-cheapest-destinations",
      name: "find_cheapest_destinations",
      description: "Inspiration search: returns the N cheapest destinations reachable from a given origin within a date range, ranked by best price. Use this when the user has not picked a destination yet ('where can I fly cheaply from MLA in September?').",
      schema: z.object({
        origin: z.string().length(3).describe("Origin IATA code (e.g. MLA, STN, BCN)."),
        dateFrom: z.string().describe("Earliest departure date YYYY-MM-DD."),
        dateTo: z.string().describe("Latest departure date YYYY-MM-DD."),
        airline: z.string().optional().describe("Restrict to airline display name (e.g. 'Ryanair')."),
        airlineCode: z.string().optional().describe("Restrict to airline IATA code (e.g. 'FR', 'EZY')."),
        maxPrice: z.number().optional().describe("Drop fares above this EUR-equivalent price."),
        limit: z.number().int().min(1).max(50).optional().describe("How many destinations to return (default 12).")
      }),
      handler: async ({ origin, dateFrom, dateTo, airline, airlineCode, maxPrice, limit }) => {
        const deals = await findCheapestDestinations({ origin, dateFrom, dateTo, airline, airlineCode, maxPrice, limit });
        return {
          ok: true,
          origin: origin.toUpperCase(),
          window: { dateFrom, dateTo },
          count: deals.length,
          destinations: deals
        };
      }
    });
    ToolCheapestDates = defineTool({
      id: "tool-cheapest-dates",
      name: "find_cheapest_dates",
      description: "Calendar view: returns the cheapest one-way price per date for a fixed origin\u2192destination pair across a date window. Use this when the user is open to travel dates and wants a heatmap ('when is the cheapest day to fly MLA\u2192BCN this month?').",
      schema: z.object({
        origin: z.string().length(3),
        destination: z.string().length(3),
        dateFrom: z.string(),
        dateTo: z.string(),
        airlineCode: z.string().optional(),
        limit: z.number().int().min(1).max(120).optional().describe("Cap rows (default 60).")
      }),
      handler: async ({ origin, destination, dateFrom, dateTo, airlineCode, limit }) => {
        const cells = await findCheapestDates({ origin, destination, dateFrom, dateTo, airlineCode, limit });
        return {
          ok: true,
          origin: origin.toUpperCase(),
          destination: destination.toUpperCase(),
          window: { dateFrom, dateTo },
          count: cells.length,
          cells
        };
      }
    });
    ToolBestRoundTrip = defineTool({
      id: "tool-best-round-trip",
      name: "find_best_round_trip",
      description: "Bundle search: joins the cheapest outbound and return legs into priced round-trip bundles ranked by total price, respecting min/max trip length. Replaces the older TS-based pairing logic with a single ClickHouse self-join \u2014 answers 'cheapest round trip A\u2194B for a N-day holiday'.",
      schema: z.object({
        origin: z.string().length(3),
        destination: z.string().length(3),
        dateFrom: z.string(),
        dateTo: z.string(),
        minDays: z.number().int().min(1).max(60).optional().describe("Min trip length in days (default 3)."),
        maxDays: z.number().int().min(1).max(60).optional().describe("Max trip length in days (default 14)."),
        airlineCode: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional().describe("Top-K bundles (default 5).")
      }),
      handler: async ({ origin, destination, dateFrom, dateTo, minDays, maxDays, airlineCode, limit }) => {
        const bundles = await findBestRoundTrip({ origin, destination, dateFrom, dateTo, minDays, maxDays, airlineCode, limit });
        return {
          ok: true,
          origin: origin.toUpperCase(),
          destination: destination.toUpperCase(),
          window: { dateFrom, dateTo, minDays: minDays ?? 3, maxDays: maxDays ?? 14 },
          count: bundles.length,
          options: bundles
        };
      }
    });
    ToolBestOneWay = defineTool({
      id: "tool-best-one-way",
      name: "find_best_one_way",
      description: "K cheapest one-way fares for a route, one per date, sorted by price ascending. Useful when a user wants the absolute lowest ticket regardless of dates.",
      schema: z.object({
        origin: z.string().length(3),
        destination: z.string().length(3),
        dateFrom: z.string(),
        dateTo: z.string(),
        airlineCode: z.string().optional(),
        limit: z.number().int().min(1).max(60).optional().describe("Default 10.")
      }),
      handler: async ({ origin, destination, dateFrom, dateTo, airlineCode, limit }) => {
        const rows = await findBestOneWay({ origin, destination, dateFrom, dateTo, airlineCode, limit });
        return {
          ok: true,
          origin: origin.toUpperCase(),
          destination: destination.toUpperCase(),
          count: rows.length,
          fares: rows
        };
      }
    });
    ToolCheapestFromAny = defineTool({
      id: "tool-cheapest-from-any",
      name: "find_cheapest_from_any_origin",
      description: "Compare multiple origin airports (e.g. all London airports) to find the single cheapest combination to each destination. Returns ranked destinations with the best origin and a sorted list of alternatives.",
      schema: z.object({
        origins: z.array(z.string().length(3)).min(1).max(8).describe("Origin IATAs (e.g. ['STN','LGW','LTN'])."),
        destination: z.string().length(3).optional().describe("Optional specific destination filter."),
        dateFrom: z.string(),
        dateTo: z.string(),
        limit: z.number().int().min(1).max(50).optional().describe("Default 10 destinations.")
      }),
      handler: async ({ origins, destination, dateFrom, dateTo, limit }) => {
        const deals = await findCheapestFromAnyOrigin({ origins, destination, dateFrom, dateTo, limit });
        return {
          ok: true,
          origins: origins.map((o) => o.toUpperCase()),
          window: { dateFrom, dateTo },
          count: deals.length,
          destinations: deals
        };
      }
    });
    ToolWeekendDeals = defineTool({
      id: "tool-weekend-deals",
      name: "find_weekend_deals",
      description: "Weekend-trip preset: bundles round trips that depart Fri\u2013Sun and return Fri\u2013Sun within a N\xB12 day window, ranked by total. Built for natural language 'I want a cheap weekend in BCN'.",
      schema: z.object({
        origin: z.string().length(3),
        destination: z.string().length(3),
        dateFrom: z.string(),
        dateTo: z.string(),
        nightCount: z.number().int().min(1).max(21).optional().describe("Number of nights (default 4)."),
        airlineCode: z.string().optional(),
        limit: z.number().int().min(1).max(20).optional().describe("Top-K bundles (default 5).")
      }),
      handler: async ({ origin, destination, dateFrom, dateTo, nightCount, airlineCode, limit }) => {
        const bundles = await findWeekendDeals({ origin, destination, dateFrom, dateTo, nightCount, airlineCode, limit });
        return {
          ok: true,
          origin: origin.toUpperCase(),
          destination: destination.toUpperCase(),
          window: { dateFrom, dateTo, nights: nightCount ?? 4 },
          count: bundles.length,
          options: bundles
        };
      }
    });
    ToolDatasetFreshness = defineTool({
      id: "tool-dataset-freshness",
      name: "get_dataset_freshness",
      description: "Returns how fresh the flight_listings data is (max observed_at per airline + per route) plus row counts. Use this BEFORE quoting prices so the LLM can warn the user if data is stale or sparse.",
      schema: z.object({}),
      handler: async () => {
        const f = await getDatasetFreshness();
        return { ok: true, freshness: f, hints: buildToolHints(f) };
      }
    });
    ToolListFavorites = defineTool({
      id: "tool-list-favorites",
      name: "list_favorites",
      description: "List the user's saved trip itineraries.",
      schema: z.object({}),
      handler: async () => ({ ok: true, count: listFavorites().length, favorites: listFavorites() })
    });
    ToolSaveFavorite = defineTool({
      id: "tool-save-favorite",
      name: "save_favorite",
      description: "Persist an itinerary (with its legs, price, currency) to the user's favorites.",
      schema: z.object({
        itinerary: z.object({
          id: z.string(),
          title: z.string(),
          totalPrice: z.number(),
          currency: z.string(),
          legs: z.array(z.object({
            origin: z.string(),
            destination: z.string(),
            date: z.string().optional(),
            price: z.number(),
            currency: z.string(),
            airline: z.string().optional()
          }))
        })
      }),
      handler: async ({ itinerary }) => {
        const fav = saveFavorite(itinerary);
        return { ok: true, favorite: fav };
      }
    });
    ToolRemoveFavorite = defineTool({
      id: "tool-remove-favorite",
      name: "remove_favorite",
      description: "Remove a saved favorite by its favorite id.",
      schema: z.object({ favoriteId: z.string().uuid() }),
      handler: async ({ favoriteId }) => ({ ok: removeFavorite(favoriteId) })
    });
    ALL_TOOLS = [
      ToolSearchAirports,
      ToolAirportFares,
      ToolCheapestDestinations,
      ToolCheapestDates,
      ToolBestOneWay,
      ToolBestRoundTrip,
      ToolCheapestFromAny,
      ToolWeekendDeals,
      ToolDatasetFreshness,
      ToolRoundTrip,
      ToolMultiStop,
      ToolRefreshCrawl,
      ToolListFavorites,
      ToolSaveFavorite,
      ToolRemoveFavorite
    ];
  }
});

// src/llm/key-vault.ts
var key_vault_exports = {};
__export(key_vault_exports, {
  deleteUserKey: () => deleteUserKey,
  getUserKey: () => getUserKey,
  resolveCredentials: () => resolveCredentials,
  setUserKey: () => setUserKey
});
import { existsSync as existsSync2, readFileSync as readFileSync2, writeFileSync, mkdirSync } from "node:fs";
import { join as join2 } from "node:path";
import { randomUUID as randomUUID2, createCipheriv, createDecipheriv, scryptSync } from "node:crypto";
function deriveKey() {
  const secret = process.env.BYOK_VAULT_SECRET || process.env.TRIGGER_SECRET_KEY || "hackathron-default-secret";
  return scryptSync(secret, "wayfarer-salt", 32);
}
function encrypt(plain) {
  const iv = randomUUID2().replace(/-/g, "").slice(0, 16);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(), Buffer.from(iv, "hex"));
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv}.${enc.toString("hex")}.${tag.toString("hex")}`;
}
function decrypt(blob) {
  const parts = blob.split(".");
  if (parts.length !== 3) throw new Error("malformed vault entry");
  const [iv, enc, tag] = parts;
  if (!iv || !enc || !tag) throw new Error("malformed vault entry");
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(), Buffer.from(iv, "hex"));
  decipher.setAuthTag(Buffer.from(tag, "hex"));
  const dec = Buffer.concat([decipher.update(Buffer.from(enc, "hex")), decipher.final()]);
  return dec.toString("utf8");
}
function loadVault() {
  if (cache2) return cache2;
  if (!existsSync2(VAULT_PATH)) {
    cache2 = { users: {} };
    return cache2;
  }
  try {
    const raw = readFileSync2(VAULT_PATH, "utf8");
    cache2 = JSON.parse(raw);
    if (!cache2.users) cache2.users = {};
    return cache2;
  } catch (err) {
    log6.warn("Failed to read vault; starting empty", { error: err.message });
    cache2 = { users: {} };
    return cache2;
  }
}
function persist() {
  if (!cache2) return;
  mkdirSync(join2(VAULT_PATH, ".."), { recursive: true });
  writeFileSync(VAULT_PATH, JSON.stringify(cache2, null, 2));
  try {
    const { chmodSync } = __require("node:fs");
    chmodSync(VAULT_PATH, 384);
  } catch {
  }
}
function setUserKey(userId, entry) {
  const vault = loadVault();
  vault.users[userId] = {
    provider: entry.provider,
    apiKey: encrypt(entry.apiKey),
    model: entry.model,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  persist();
  log6.info("BYOK key stored", { userId, provider: entry.provider });
}
function getUserKey(userId) {
  const vault = loadVault();
  const entry = vault.users[userId];
  if (!entry) return null;
  try {
    return { ...entry, apiKey: decrypt(entry.apiKey) };
  } catch (err) {
    log6.warn("Failed to decrypt vault entry", { userId, error: err.message });
    return null;
  }
}
function deleteUserKey(userId) {
  const vault = loadVault();
  if (!vault.users[userId]) return false;
  delete vault.users[userId];
  persist();
  return true;
}
function resolveCredentials(userId) {
  if (userId) {
    log6.warn("BYOK is disabled \u2014 ignoring stored key for user", { userId });
  }
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) return { provider: "openai", apiKey: openaiKey, model: process.env.OPENAI_MODEL, source: "env" };
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) return { provider: "anthropic", apiKey: anthropicKey, model: process.env.ANTHROPIC_MODEL, source: "env" };
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (openrouterKey) return { provider: "openrouter", apiKey: openrouterKey, model: process.env.OPENROUTER_MODEL, source: "env" };
  const minimaxKey = process.env.MINIMAX_API_KEY;
  if (minimaxKey) return { provider: "minimax", apiKey: minimaxKey, model: process.env.MINIMAX_MODEL || "MiniMax-M3", source: "env" };
  return { provider: "openai", apiKey: "", source: "none" };
}
var log6, VAULT_PATH, cache2;
var init_key_vault = __esm({
  "src/llm/key-vault.ts"() {
    "use strict";
    init_logger();
    log6 = logger("src/llm/key-vault.ts");
    VAULT_PATH = join2(import.meta.dirname, "..", "..", "data", "byok-vault.json");
    cache2 = null;
  }
});

// src/llm/client.ts
var client_exports = {};
__export(client_exports, {
  runLlmAgent: () => runLlmAgent
});
function toOpenAiTools() {
  return listTools().map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters
    }
  }));
}
function toAnthropicTools() {
  return listTools().map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters
  }));
}
async function runLlmAgent(req, creds, sink) {
  const provider = creds.provider || "openai";
  const model = req.model || creds.model || defaultModel(provider);
  const maxIterations = Math.max(1, Math.min(10, req.maxIterations ?? 6));
  const toolCalls = [];
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...req.messages
  ];
  const emit = (e) => {
    if (sink) try {
      sink(e);
    } catch {
    }
  };
  if (!creds.apiKey) {
    emit({ type: "error", error: "no_credentials" });
    return {
      ok: false,
      provider,
      model,
      content: null,
      toolCalls,
      iterations: 0,
      source: "none",
      error: "No LLM credentials configured. Set OPENAI_API_KEY (or ANTHROPIC_API_KEY / OPENROUTER_API_KEY / MINIMAX_API_KEY) on the server."
    };
  }
  emit({ type: "status", status: "thinking", provider, model });
  let iterations = 0;
  let finalContent = null;
  while (iterations < maxIterations) {
    iterations += 1;
    let raw;
    try {
      raw = await callProvider(provider, { apiKey: creds.apiKey, model, messages });
    } catch (err) {
      log7.warn("LLM call failed", { provider, error: err.message });
      emit({ type: "error", error: err.message });
      return {
        ok: false,
        provider,
        model,
        content: null,
        toolCalls,
        iterations,
        source: "env",
        error: err.message
      };
    }
    const assistantMessage = raw.assistantMessage;
    messages.push(assistantMessage);
    finalContent = typeof assistantMessage.content === "string" ? assistantMessage.content : finalContent;
    if (typeof assistantMessage.content === "string" && assistantMessage.content) {
      emit({ type: "assistant_delta", content: assistantMessage.content });
    }
    emit({ type: "assistant_message", content: assistantMessage.content, toolCalls: assistantMessage.tool_calls ?? [] });
    const calls = assistantMessage.tool_calls ?? [];
    if (calls.length === 0) break;
    for (const call of calls) {
      let parsedArgs;
      try {
        parsedArgs = JSON.parse(call.arguments);
      } catch {
        parsedArgs = call.arguments;
      }
      const tool = getToolByName(call.name);
      emit({ type: "tool_call", id: call.id, name: call.name, arguments: parsedArgs });
      let result;
      let toolError;
      if (!tool) {
        toolError = `unknown tool: ${call.name}`;
        result = { ok: false, error: toolError };
      } else {
        const parsed = tool.schema.safeParse(parsedArgs);
        if (!parsed.success) {
          toolError = `invalid arguments: ${JSON.stringify(parsed.error.issues)}`;
          result = { ok: false, error: toolError };
        } else {
          try {
            result = await tool.handler(parsed.data);
          } catch (err) {
            toolError = err.message;
            result = { ok: false, error: toolError };
          }
        }
      }
      toolCalls.push({ tool: call.name, arguments: parsedArgs, result });
      if (result && typeof result === "object") {
        const r = result;
        if (r.runId && typeof r.runId === "string") {
          emit({
            type: "run_triggered",
            toolId: call.id,
            toolName: call.name,
            runId: r.runId,
            task: typeof r.task === "string" ? r.task : null,
            crawlRunId: typeof r.crawlRunId === "string" ? r.crawlRunId : null,
            publicAccessToken: typeof r.publicAccessToken === "string" ? r.publicAccessToken : null
          });
        }
      }
      emit({ type: "tool_result", id: call.id, name: call.name, result });
      messages.push({
        role: "tool",
        content: typeof result === "string" ? result : JSON.stringify(result),
        tool_call_id: call.id,
        name: call.name
      });
    }
  }
  emit({ type: "done", iterations, toolCalls: toolCalls.length });
  return {
    ok: true,
    provider,
    model,
    content: finalContent,
    toolCalls,
    iterations,
    source: "env"
  };
}
function getToolByName(name) {
  for (const t of listTools()) if (t.name === name) return t;
  return null;
}
function defaultModel(provider) {
  if (provider === "anthropic") return "claude-3-5-sonnet-latest";
  if (provider === "openrouter") return "openai/gpt-4o-mini";
  return "gpt-4o-mini";
}
async function callProvider(provider, args) {
  if (provider === "openai" || provider === "openrouter" || provider === "minimax") {
    const url = provider === "openrouter" ? "https://openrouter.ai/api/v1/chat/completions" : provider === "minimax" ? "https://api.minimax.io/v1/chat/completions" : "https://api.openai.com/v1/chat/completions";
    const body = {
      model: args.model,
      messages: args.messages,
      tools: toOpenAiTools(),
      tool_choice: "auto"
    };
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${args.apiKey}`
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
    const data = await res.json();
    const message = data.choices[0]?.message;
    if (!message) throw new Error("LLM returned no choices");
    if (Array.isArray(message.tool_calls)) {
      message.tool_calls = message.tool_calls.map((c) => ({
        id: String(c.id ?? ""),
        name: String(c.function?.name ?? c.name ?? ""),
        arguments: String(c.function?.arguments ?? c.arguments ?? "{}")
      }));
    }
    return { assistantMessage: message };
  }
  if (provider === "anthropic") {
    const system = args.messages.find((m) => m.role === "system")?.content ?? "";
    const nonSystem = args.messages.filter((m) => m.role !== "system");
    const body = {
      model: args.model,
      max_tokens: 2048,
      system,
      messages: nonSystem.map(toAnthropicMessage),
      tools: toAnthropicTools()
    };
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": args.apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
    const data = await res.json();
    return fromAnthropicResponse(data);
  }
  throw new Error(`unsupported LLM provider: ${provider}`);
}
function toAnthropicMessage(m) {
  if (m.role === "tool") {
    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: m.tool_call_id,
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? null)
        }
      ]
    };
  }
  if (m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0) {
    const blocks = [];
    if (m.content) blocks.push({ type: "text", text: m.content });
    for (const call of m.tool_calls) {
      blocks.push({
        type: "tool_use",
        id: call.id,
        name: call.name,
        input: (() => {
          try {
            return JSON.parse(call.arguments);
          } catch {
            return {};
          }
        })()
      });
    }
    return { role: "assistant", content: blocks };
  }
  return { role: m.role, content: m.content ?? "" };
}
function fromAnthropicResponse(data) {
  const toolCalls = [];
  let text = null;
  for (const block of data.content) {
    if (block.type === "text" && block.text) {
      text = text ? `${text}
${block.text}` : block.text;
    } else if (block.type === "tool_use" && block.id && block.name) {
      toolCalls.push({ id: block.id, name: block.name, arguments: JSON.stringify(block.input ?? {}) });
    }
  }
  const message = {
    role: "assistant",
    content: text
  };
  if (toolCalls.length > 0) message.tool_calls = toolCalls;
  return { assistantMessage: message };
}
var log7, SYSTEM_PROMPT;
var init_client = __esm({
  "src/llm/client.ts"() {
    "use strict";
    init_logger();
    init_registry();
    log7 = logger("src/llm/client.ts");
    SYSTEM_PROMPT = `You are Wayfare, a travel-planning assistant for the Hackathron trip planner.
You help users plan flights between European airports that are crawled from Ryanair (and optionally EasyJet).
You have a rich set of tools. Pick the right one based on the user's question:

- "Where can I fly cheaply from X?" \u2192 \`find_cheapest_destinations\` (inspiration, ranked by best fare per destination in the window).
- "When is the cheapest day to fly X\u2192Y?" \u2192 \`find_cheapest_dates\` (cheapest one-way per date, full window).
- "Cheapest one-way tickets X\u2192Y" \u2192 \`find_best_one_way\` (K cheapest fares, price-asc).
- "Cheapest round trip A\u2194B for an N-day trip" \u2192 \`find_best_round_trip\` (self-joined, ranked by total).
- "Cheap weekend in BCN" / "long weekend" \u2192 \`find_weekend_deals\` (Fri-Sun departure/return only).
- "From any London airport" \u2192 \`find_cheapest_from_any_origin\` (pass multiple origins, server picks best + alternatives).
- "All fares from X" \u2192 \`get_airport_fares\`.
- "Round trip A\u2194B (legacy TS pairing)" \u2192 \`plan_round_trip\`.
- "Multi-stop trip through several cities" \u2192 \`plan_multi_stop\` (single-shot SQL planner across all permutations).
- Before quoting prices, call \`get_dataset_freshness\` and respect its warnings; if data is older than 48h, mention the freshness window to the user.

Always call the relevant tool rather than guessing. Cite prices and dates from the tool output.
Prefer round-trip itineraries when the user asks for a holiday. Use multi-stop when they list multiple destinations.
If pricing data is missing for a leg or destination, call \`trigger_refresh_crawl\` FIRST so the crawl actually runs (the tool both enqueues the work AND fires the queue worker); then either retry the lookup or recommend the user wait for results.
All LLM calls are routed through our hosting service \u2014 there is no per-user key. The Trigger.dev tasks you fire (crawl-queue-worker / crawl-pending-item) will run to completion and the frontend will be updated in realtime with their status.
Be concise. Output should be 2\u20136 short paragraphs max.`;
  }
});

// src/frontend/server.ts
import "dotenv/config";
import { spawn } from "node:child_process";
import { readFileSync as readFileSync3 } from "node:fs";
import { join as join3 } from "node:path";
import express from "express";
import { runs, tasks as tasks2 } from "@trigger.dev/sdk";

// src/trigger/task-descriptions.ts
var TASK_DESCRIPTIONS = {
  "sync-ryanair-routes": {
    label: "Sync Ryanair routes",
    summary: "Fetches the full Ryanair active-airports catalogue and, for each origin, calls the per-airport routes endpoint. Persists the result to the airline_routes table so the crawlers know which destinations to scan.",
    params: ["concurrency (1\u201320, default 1)"],
    eta: "~5.5 min for 224 origins at concurrency=1"
  },
  "crawl-ryanair-range-route": {
    label: "[LEGACY] Crawl one Ryanair origin (range, FARFND monthly)",
    summary: "LEGACY path (no longer triggered from the frontend): calls Ryanair's FARFND cheapestPerDay endpoint once per destination for the given origin and date range \u2014 one HTTP request covers every day in the outbound month (outboundMonthOfDate=dateFrom), so a 30-day window is 1 call per destination, not 30. Writes completed/failed rows to crawl_progress directly. Prefer crawl-queue-worker (fronted by /api/trigger/full-scan or /api/trigger/single-origin) which goes through the proper pending \u2192 processing \u2192 completed/failed queue lifecycle.",
    params: ["originIata", "dateFrom", "dateTo", "adults", "requestDelayMs"],
    eta: "~25s per destination at default rate (1 call each)"
  },
  "crawl-ryanair-range": {
    label: "[LEGACY] Full Ryanair scan (range, FARFND monthly)",
    summary: "LEGACY fan-out (no longer triggered from the frontend): batches crawl-ryanair-range-route across the supplied origins. Writes completed/failed rows to crawl_progress directly with no pending state, so the dashboard shows nothing until each destination finishes. Prefer crawl-queue-worker (fronted by /api/trigger/full-scan or /api/trigger/single-origin) which seeds the queue first so you can see what's pending, skip items, or re-prioritise.",
    params: ["origins[]", "dateFrom", "dateTo", "destinationFilter?"],
    eta: "~25s per (origin, destination) at default rate \u2014 e.g. 9 origins \xD7 ~93 destinations \u2248 5.8 h"
  },
  "crawl-ryanair-route": {
    label: "Crawl one Ryanair origin (legacy per-date)",
    summary: "Legacy crawler: one booking availability call per (origin, destination, date) pair. Slower than the range crawler \u2014 prefer crawl-ryanair-range-route for new work.",
    params: ["originIata", "dateFrom", "dateTo"],
    eta: "~25s per (destination, date) pair"
  },
  "crawl-ryanair": {
    label: "Crawl Ryanair (legacy fan-out)",
    summary: "Legacy fan-out wrapper around crawl-ryanair-route. Same destination-by-destination approach as the range crawler but emits one HTTP call per date in the window.",
    params: ["origins[]", "dateFrom", "dateTo"],
    eta: "O(dateFrom..dateTo \xD7 destinations \xD7 25s)"
  },
  "crawl-easyjet-route": {
    label: "Crawl one EasyJet origin",
    summary: "Calls the EasyJet availability API once per destination for the given origin and date range. Same resume/mark-completed behaviour as the Ryanair range crawler.",
    params: ["originIata", "destinations[]", "dateFrom", "dateTo"],
    eta: "~25s per destination at default rate"
  },
  "crawl-easyjet": {
    label: "Crawl EasyJet (fan-out)",
    summary: "Fan-out wrapper that batches crawl-easyjet-route across multiple origins.",
    params: ["origins[]", "dateFrom", "dateTo"],
    eta: "Depends on origin count and destination list"
  },
  "crawl-airlines": {
    label: "Crawl all airlines",
    summary: "Top-level entry point that fan-outs to per-airline crawlers (Ryanair for now). Designed for the periodic scheduler.",
    params: ["airlines[]", "origins by code", "dateFrom", "dateTo"],
    eta: "Driven by the underlying per-airline crawler ETAs"
  },
  "seed-crawl-queue": {
    label: "Seed crawl queue",
    summary: "Reads airline_routes and inserts one pending work item per (origin, destination, date range). Workers claim and process destination rows sequentially.",
    params: ["airline", "origins[]", "dateFrom", "dateTo"],
    eta: "Seconds (DB insert only)"
  },
  "crawl-queue-worker": {
    label: "Crawl queue worker (FARFND monthly)",
    summary: "Claims the next pending queue item, calls the Ryanair range crawler (FARFND cheapestPerDay \u2014 1 HTTP call per (origin, destination) covering the whole month) for that origin, then marks it completed or failed. Auto-reclaims stale items after 30 min. Loops up to maxIterations per run.",
    params: ["airline", "crawlRunId", "maxIterations"],
    eta: "~25s per (origin, destination) (one at a time)"
  },
  "crawl-pending-item": {
    label: "Crawl one pending item (FARFND monthly)",
    summary: "Claims a specific crawl_progress row (airline, origin, destination, date_from, date_to) \u2014 picked by the operator from the frontend queue \u2014 runs the Ryanair range crawler (FARFND cheapestPerDay \u2014 1 HTTP call per destination covering the whole month) for that one destination, and marks the row completed or failed. Use this to retry or selectively drain individual items without firing the full queue worker. Pass force=true to steal a row that's currently in 'processing' (e.g. grabbed by the queue worker).",
    params: ["airline", "originIata", "destinationIata", "dateFrom", "dateTo", "force?"],
    eta: "~25s per destination at default rate (1 FARFND call)"
  },
  "llm-chat-agent": {
    label: "Wayfare AI chat agent",
    summary: "Runs the Wayfare travel-planning chat agent: an LLM (OpenAI/Anthropic) with function-calling tools for airport search, fare lookup, round-trip planning, multi-stop itineraries, crawl triggering, and favorites. Emits structured log events for each LLM turn, tool call, and tool result.",
    params: ["messages[]", "model?", "maxIterations?"],
    eta: "Variable \u2014 depends on LLM latency and number of tool calls (typically seconds to minutes)"
  },
  "crawl-airlines-six-hours": {
    label: "Scheduled: crawl all airlines (every 6h)",
    summary: "Cron schedule (0 */6 * * *) that triggers crawl-airlines with RYANAIR_ORIGINS from env. Used by the production scheduler.",
    params: ["cron-managed"],
    eta: "n/a"
  }
};
function listTaskDescriptions() {
  return Object.entries(TASK_DESCRIPTIONS).map(
    ([id, v]) => ({ id, ...v })
  );
}

// src/frontend/server.ts
init_logger();
init_crawl();

// src/lib/paced-fetch.ts
init_logger();
var FILE = "src/lib/paced-fetch.ts";
var log = logger(FILE);
function intEnv2(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}
var Pacer = class {
  constructor(minDelayMs, jitterMs) {
    this.minDelayMs = minDelayMs;
    this.jitterMs = jitterMs;
  }
  chain = Promise.resolve();
  wait() {
    const minDelay = this.minDelayMs;
    const jitter = this.jitterMs;
    this.chain = this.chain.then(
      () => new Promise((resolve) => {
        const delay = jitter > 0 ? minDelay + Math.floor(Math.random() * jitter) : minDelay;
        if (delay <= 0) resolve();
        else setTimeout(() => resolve(), delay);
      })
    );
    return this.chain;
  }
};
var GLOBAL_FETCH_DELAY_MS = intEnv2("GLOBAL_FETCH_DELAY_MS", 2e3);
var GLOBAL_FETCH_JITTER_MS = intEnv2("GLOBAL_FETCH_JITTER_MS", 500);
var globalPacer = new Pacer(GLOBAL_FETCH_DELAY_MS, GLOBAL_FETCH_JITTER_MS);
var _originalFetch = typeof globalThis.fetch !== "undefined" ? globalThis.fetch.bind(globalThis) : void 0;

// src/config/index.ts
init_crawl();

// src/airlines/ryanair.ts
init_logger();
var FILE2 = "src/airlines/ryanair.ts";
var log2 = logger(FILE2);
var RYANAIR_USE_FARFND = process.env.RYANAIR_USE_FARFND !== "false";
var RYANAIR_CORRELATION_ID = process.env.RYANAIR_CORRELATION_ID ?? "00000000-0000-0000-0000-000000000000";
var RYANAIR_XID_COOKIE = process.env.RYANAIR_XID_COOKIE ?? "";
var ryanairPacer = new Pacer(
  CRAWL_CONFIG.ryanair.requestDelayMs,
  CRAWL_CONFIG.ryanair.requestJitterMs
);
var RYANAIR_DEFAULT_BASES = [
  "AAR",
  "ABZ",
  "ACE",
  "AGA",
  "AGP",
  "AHO",
  "ALC",
  "AMM",
  "AMS",
  "AOI",
  "ARN",
  "ATH",
  "BBU",
  "BCN",
  "BDS",
  "BEM",
  "BER",
  "BFS",
  "BGY",
  "BHX",
  "BIQ",
  "BJV",
  "BLQ",
  "BNX",
  "BOH",
  "BOJ",
  "BRE",
  "BRI",
  "BRQ",
  "BRS",
  "BRU",
  "BSL",
  "BTS",
  "BUD",
  "BVA",
  "BVE",
  "BZG",
  "BZR",
  "CAG",
  "CCF",
  "CDT",
  "CFU",
  "CGN",
  "CHQ",
  "CIA",
  "CLJ",
  "CPH",
  "CRL",
  "CRV",
  "CTA",
  "CUF",
  "CWL",
  "DBV",
  "DLE",
  "DLM",
  "DUB",
  "EDI",
  "EFL",
  "EGC",
  "EIN",
  "EMA",
  "ERH",
  "ESU",
  "EXT",
  "FAO",
  "FCO",
  "FDH",
  "FEZ",
  "FKB",
  "FMM",
  "FMO",
  "FNC",
  "FNI",
  "FRL",
  "FSC",
  "FUE",
  "GDN",
  "GLA",
  "GNB",
  "GOA",
  "GOT",
  "GRO",
  "HAM",
  "HEL",
  "HER",
  "HHN",
  "IAS",
  "IBZ",
  "INI",
  "JMK",
  "JSI",
  "JTR",
  "KGS",
  "KIR",
  "KLU",
  "KLX",
  "KRK",
  "KSC",
  "KTW",
  "KUN",
  "LBA",
  "LBC",
  "LCA",
  "LCJ",
  "LDE",
  "LDY",
  "LEI",
  "LGW",
  "LIG",
  "LIL",
  "LIS",
  "LNZ",
  "LPA",
  "LPL",
  "LRH",
  "LTN",
  "LUX",
  "LUZ",
  "LXS",
  "MAD",
  "MAH",
  "MAN",
  "MLA",
  "MME",
  "MMX",
  "MRS",
  "MXP",
  "NAP",
  "NCE",
  "NCL",
  "NDR",
  "NOC",
  "NQY",
  "NRN",
  "NTE",
  "NUE",
  "NWI",
  "OLB",
  "OPO",
  "ORK",
  "OSI",
  "OSL",
  "OSR",
  "OTP",
  "OUD",
  "OZZ",
  "PAD",
  "PDV",
  "PED",
  "PEG",
  "PFO",
  "PGF",
  "PIK",
  "PIS",
  "PLQ",
  "PMF",
  "PMI",
  "PMO",
  "POZ",
  "PRG",
  "PSA",
  "PSR",
  "PUY",
  "PVK",
  "QSR",
  "RAK",
  "RBA",
  "RDZ",
  "REG",
  "REU",
  "RHO",
  "RIX",
  "RJK",
  "RMI",
  "RMU",
  "RVN",
  "RZE",
  "SCN",
  "SCQ",
  "SDR",
  "SFT",
  "SJJ",
  "SKG",
  "SNN",
  "SOF",
  "SPU",
  "STN",
  "SUF",
  "SVQ",
  "SZG",
  "SZY",
  "SZZ",
  "TFS",
  "TGD",
  "TIA",
  "TLL",
  "TLS",
  "TNG",
  "TPS",
  "TRF",
  "TRN",
  "TRS",
  "TSF",
  "TTU",
  "TUF",
  "VAR",
  "VCE",
  "VIE",
  "VIL",
  "VIT",
  "VLC",
  "VNO",
  "VOL",
  "VRN",
  "VST",
  "VXO",
  "WAW",
  "WMI",
  "WRO",
  "XCR",
  "ZAD",
  "ZAG",
  "ZAZ",
  "ZTH"
];

// src/observability/ids.ts
import { randomBytes } from "node:crypto";
function newTraceId(seed) {
  if (seed) return seed.replace(/-/g, "").toLowerCase().padEnd(32, "0").slice(0, 32);
  return randomBytes(16).toString("hex");
}

// src/frontend/server.ts
var PORT = Number(process.env.FRONTEND_PORT ?? 3030);
var HYPERDX_URL = (process.env.HYPERDX_URL ?? "http://localhost:8090").replace(/\/$/, "");
var log8 = logger("src/frontend/server.ts");
var app = express();
app.use(express.json());
app.use(express.static(join3(import.meta.dirname, "..", "..", "public")));
app.use((req, res, next) => {
  const startedAt = Date.now();
  const bodyBytes = req.headers["content-length"] ? Number(req.headers["content-length"]) : 0;
  log8.info(">>> request enter", {
    method: req.method,
    path: req.originalUrl,
    ip: req.ip ?? req.socket.remoteAddress,
    bytes: bodyBytes
  });
  let logged = false;
  const finalize = () => {
    if (logged) return;
    logged = true;
    const durationMs = Date.now() - startedAt;
    const status = res.statusCode;
    const meta = {
      method: req.method,
      path: req.originalUrl,
      status,
      durationMs
    };
    if (status >= 500) log8.error("<<< request exit", meta);
    else if (status >= 400) log8.warn("<<< request exit", meta);
    else log8.info("<<< request exit", meta);
  };
  res.on("finish", finalize);
  res.on("close", finalize);
  next();
});
app.get("/", (_req, res) => {
  res.sendFile(join3(import.meta.dirname, "map.html"));
});
app.get("/admin", (_req, res) => {
  res.sendFile(join3(import.meta.dirname, "index.html"));
});
function parseIataList(input) {
  if (!Array.isArray(input)) {
    if (typeof input === "string") {
      return input.split(",").map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z]{3}$/.test(s));
    }
    return [];
  }
  return input.map((s) => String(s).trim().toUpperCase()).filter((s) => /^[A-Z]{3}$/.test(s));
}
function nextMonthStartIso() {
  const d = new Date(Date.UTC((/* @__PURE__ */ new Date()).getUTCFullYear(), (/* @__PURE__ */ new Date()).getUTCMonth() + 1, 1));
  return d.toISOString().slice(0, 10);
}
function monthAfterNextStartIso() {
  const d = new Date(Date.UTC((/* @__PURE__ */ new Date()).getUTCFullYear(), (/* @__PURE__ */ new Date()).getUTCMonth() + 2, 1));
  return d.toISOString().slice(0, 10);
}
function uuidToTraceId(runId) {
  return newTraceId(runId);
}
async function resolveTraceId(runIdRaw) {
  if (runIdRaw.startsWith("run_")) {
    const run = await runs.retrieve(runIdRaw);
    const payload = run.payload;
    const crawlRunId = payload?.crawlRunId;
    if (!crawlRunId) throw new Error(`No crawlRunId in run payload for ${runIdRaw}`);
    return newTraceId(crawlRunId);
  }
  return newTraceId(runIdRaw);
}
app.get("/api/health", async (_req, res) => {
  try {
    const { pingClickHouse: pingClickHouse2, getClickHouseForOtel: getClickHouseForOtel2 } = await Promise.resolve().then(() => (init_clickhouse(), clickhouse_exports));
    const flights = await pingClickHouse2();
    let otel = false;
    try {
      const ch = getClickHouseForOtel2();
      const r = await ch.ping();
      otel = Boolean(r.success);
    } catch {
      otel = false;
    }
    res.json({
      ok: true,
      ts: (/* @__PURE__ */ new Date()).toISOString(),
      clickhouse: { flights, otel },
      hyperdx: { url: HYPERDX_URL }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
app.get("/api/tasks", (_req, res) => {
  res.json({ ok: true, tasks: listTaskDescriptions() });
});
app.get("/api/config", (_req, res) => {
  const envOrigins = parseIataList(process.env.RYANAIR_ORIGINS);
  res.json({
    ok: true,
    crawl: CRAWL_CONFIG,
    ryanair: {
      useFarfnd: process.env.RYANAIR_USE_FARFND !== "false",
      envOrigins,
      defaultBasesCount: RYANAIR_DEFAULT_BASES.length,
      defaultBases: RYANAIR_DEFAULT_BASES
    },
    frontend: { port: PORT },
    hyperdx: { url: HYPERDX_URL },
    server: { version: readPackageVersion(), pid: process.pid, startedAt: (/* @__PURE__ */ new Date()).toISOString() }
  });
});
function readPackageVersion() {
  try {
    const raw = readFileSync3(join3(import.meta.dirname, "..", "..", "package.json"), "utf8");
    return JSON.parse(raw).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
app.post("/api/trigger/sync-ryanair-routes", async (req, res) => {
  try {
    const source = req.body?.source === "bases" ? "bases" : "dynamic";
    const concurrency = Math.min(
      20,
      Math.max(1, Math.floor(Number(req.body?.concurrency ?? 1)))
    );
    if (source === "dynamic") {
      const handle = await tasks2.trigger("sync-ryanair-routes", { concurrency });
      res.json({
        ok: true,
        runId: handle.id,
        publicAccessToken: handle.publicAccessToken,
        task: "sync-ryanair-routes",
        params: { source, concurrency }
      });
      return;
    }
    const origins = parseIataList(req.body?.origins ?? []);
    const envOrigins = parseIataList(process.env.RYANAIR_ORIGINS);
    const finalOrigins = origins.length > 0 ? origins : envOrigins.length > 0 ? envOrigins : void 0;
    const args = ["--source", "bases"];
    if (finalOrigins && finalOrigins.length > 0) {
      args.push("--origins", finalOrigins.join(","));
    }
    const result = await spawnScript("sync-ryanair-routes.ts", args);
    res.json({
      ok: result.code === 0,
      exitCode: result.code,
      durationMs: result.durationMs,
      params: { source, concurrency, origins: finalOrigins },
      stdout: result.stdout,
      stderr: result.stderr
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
app.post("/api/trigger/full-scan", async (req, res) => {
  try {
    const dateFrom = req.body?.dateFrom ?? nextMonthStartIso();
    const dateTo = req.body?.dateTo ?? monthAfterNextStartIso();
    const requestedOrigins = parseIataList(req.body?.origins ?? []);
    const envOrigins = parseIataList(process.env.RYANAIR_ORIGINS);
    const origins = requestedOrigins.length > 0 ? requestedOrigins : envOrigins;
    const crawlRunId = req.body?.runId || crypto.randomUUID();
    const adults = Math.max(1, Math.floor(Number(req.body?.adults ?? CRAWL_CONFIG.ryanair.adults)));
    const requestDelayMs = Math.max(
      0,
      Math.floor(Number(req.body?.requestDelayMs ?? CRAWL_CONFIG.ryanair.requestDelayMs))
    );
    const requestJitterMs = Math.max(
      0,
      Math.floor(Number(req.body?.requestJitterMs ?? CRAWL_CONFIG.ryanair.requestJitterMs))
    );
    const cooldownMs = Math.max(0, Math.floor(Number(req.body?.cooldownMs ?? CRAWL_CONFIG.ryanair.cooldownMs)));
    const maxIterations = Math.min(
      Math.max(1, Math.floor(Number(req.body?.maxIterations ?? 2500))),
      5e3
    );
    if (origins.length === 0) {
      res.status(400).json({
        ok: false,
        error: "origins must be provided in the request or RYANAIR_ORIGINS"
      });
      return;
    }
    const { enqueuePendingRoutes: enqueuePendingRoutes2 } = await Promise.resolve().then(() => (init_crawl_progress(), crawl_progress_exports));
    const enqueueResult = await enqueuePendingRoutes2({
      airline: "Ryanair",
      origins,
      dateFrom,
      dateTo,
      crawlRunId
    });
    const handle = await tasks2.trigger("crawl-queue-worker", {
      airline: "Ryanair",
      crawlRunId,
      maxIterations,
      adults,
      requestDelayMs,
      requestJitterMs,
      cooldownMs
    });
    res.json({
      ok: true,
      runId: handle.id,
      crawlRunId,
      traceId: uuidToTraceId(crawlRunId),
      publicAccessToken: handle.publicAccessToken,
      task: "crawl-queue-worker",
      enqueued: enqueueResult.enqueued,
      alreadyPending: enqueueResult.already_pending,
      params: {
        origins,
        dateFrom,
        dateTo,
        adults,
        requestDelayMs,
        requestJitterMs,
        cooldownMs,
        maxIterations
      },
      hyperdx: { url: `${HYPERDX_URL}/search` }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
app.post("/api/trigger/single-origin", async (req, res) => {
  try {
    const origin = String(req.body?.origin ?? "").trim().toUpperCase();
    const dateFrom = req.body?.dateFrom ?? nextMonthStartIso();
    const dateTo = req.body?.dateTo ?? monthAfterNextStartIso();
    const destinations = req.body?.destinations != null ? parseIataList(req.body.destinations) : void 0;
    const crawlRunId = req.body?.runId || crypto.randomUUID();
    const adults = Math.max(1, Math.floor(Number(req.body?.adults ?? CRAWL_CONFIG.ryanair.adults)));
    const requestDelayMs = Math.max(
      0,
      Math.floor(Number(req.body?.requestDelayMs ?? CRAWL_CONFIG.ryanair.requestDelayMs))
    );
    const requestJitterMs = Math.max(
      0,
      Math.floor(Number(req.body?.requestJitterMs ?? CRAWL_CONFIG.ryanair.requestJitterMs))
    );
    const cooldownMs = Math.max(0, Math.floor(Number(req.body?.cooldownMs ?? CRAWL_CONFIG.ryanair.cooldownMs)));
    const maxIterations = Math.min(
      Math.max(1, Math.floor(Number(req.body?.maxIterations ?? 2500))),
      5e3
    );
    if (!/^[A-Z]{3}$/.test(origin)) {
      res.status(400).json({ ok: false, error: "origin must be a 3-letter IATA code" });
      return;
    }
    const { enqueuePendingRoutes: enqueuePendingRoutes2 } = await Promise.resolve().then(() => (init_crawl_progress(), crawl_progress_exports));
    const enqueueResult = await enqueuePendingRoutes2({
      airline: "Ryanair",
      origins: [origin],
      dateFrom,
      dateTo,
      crawlRunId
    });
    const handle = await tasks2.trigger("crawl-queue-worker", {
      airline: "Ryanair",
      crawlRunId,
      maxIterations,
      adults,
      requestDelayMs,
      requestJitterMs,
      cooldownMs
    });
    res.json({
      ok: true,
      runId: handle.id,
      crawlRunId,
      traceId: uuidToTraceId(crawlRunId),
      publicAccessToken: handle.publicAccessToken,
      task: "crawl-queue-worker",
      enqueued: enqueueResult.enqueued,
      alreadyPending: enqueueResult.already_pending,
      params: {
        origin,
        dateFrom,
        dateTo,
        destinations,
        adults,
        requestDelayMs,
        requestJitterMs,
        cooldownMs,
        maxIterations
      },
      hyperdx: { url: `${HYPERDX_URL}/search` }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
app.post("/api/trigger/seed-queue", async (req, res) => {
  try {
    const airline = req.body?.airline ?? "Ryanair";
    const origins = parseIataList(req.body?.origins ?? []);
    const dateFrom = req.body?.dateFrom ?? nextMonthStartIso();
    const dateTo = req.body?.dateTo ?? monthAfterNextStartIso();
    const maxIterations = Math.min(Math.max(1, Math.floor(Number(req.body?.maxIterations ?? 100))), 1e3);
    const adults = Math.max(1, Math.floor(Number(req.body?.adults ?? CRAWL_CONFIG.ryanair.adults)));
    const requestDelayMs = Math.max(
      0,
      Math.floor(Number(req.body?.requestDelayMs ?? CRAWL_CONFIG.ryanair.requestDelayMs))
    );
    const requestJitterMs = Math.max(
      0,
      Math.floor(Number(req.body?.requestJitterMs ?? CRAWL_CONFIG.ryanair.requestJitterMs))
    );
    const cooldownMs = Math.max(0, Math.floor(Number(req.body?.cooldownMs ?? CRAWL_CONFIG.ryanair.cooldownMs)));
    if (origins.length === 0) {
      res.status(400).json({ ok: false, error: "origins array is required" });
      return;
    }
    const crawlRunId = req.body?.runId || crypto.randomUUID();
    const { enqueuePendingRoutes: enqueuePendingRoutes2 } = await Promise.resolve().then(() => (init_crawl_progress(), crawl_progress_exports));
    const enqueueResult = await enqueuePendingRoutes2({
      airline,
      origins,
      dateFrom,
      dateTo,
      crawlRunId
    });
    const handle = await tasks2.trigger("crawl-queue-worker", {
      airline,
      crawlRunId,
      maxIterations,
      adults,
      requestDelayMs,
      requestJitterMs,
      cooldownMs
    });
    res.json({
      ok: true,
      runId: handle.id,
      crawlRunId,
      traceId: uuidToTraceId(crawlRunId),
      publicAccessToken: handle.publicAccessToken,
      task: "crawl-queue-worker",
      enqueued: enqueueResult.enqueued,
      alreadyPending: enqueueResult.already_pending,
      params: { airline, origins, dateFrom, dateTo, maxIterations, adults, requestDelayMs, requestJitterMs, cooldownMs }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
app.post("/api/trigger/crawl-pending-item", async (req, res) => {
  try {
    const airline = req.body?.airline === "EasyJet" ? "EasyJet" : "Ryanair";
    const origin = String(req.body?.origin ?? "").trim().toUpperCase();
    const destination = String(req.body?.destination ?? "").trim().toUpperCase();
    const dateFrom = req.body?.dateFrom ?? nextMonthStartIso();
    const dateTo = req.body?.dateTo ?? monthAfterNextStartIso();
    const crawlRunId = req.body?.runId || crypto.randomUUID();
    const force = Boolean(req.body?.force);
    const adults = Math.max(1, Math.floor(Number(req.body?.adults ?? CRAWL_CONFIG.ryanair.adults)));
    const requestDelayMs = Math.max(
      0,
      Math.floor(Number(req.body?.requestDelayMs ?? CRAWL_CONFIG.ryanair.requestDelayMs))
    );
    const requestJitterMs = Math.max(
      0,
      Math.floor(Number(req.body?.requestJitterMs ?? CRAWL_CONFIG.ryanair.requestJitterMs))
    );
    const cooldownMs = Math.max(0, Math.floor(Number(req.body?.cooldownMs ?? CRAWL_CONFIG.ryanair.cooldownMs)));
    if (!/^[A-Z]{3}$/.test(origin)) {
      res.status(400).json({ ok: false, error: "origin must be a 3-letter IATA code" });
      return;
    }
    if (!/^[A-Z]{3}$/.test(destination)) {
      res.status(400).json({ ok: false, error: "destination must be a 3-letter IATA code" });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
      res.status(400).json({ ok: false, error: "dateFrom and dateTo must be YYYY-MM-DD" });
      return;
    }
    const handle = await tasks2.trigger("crawl-pending-item", {
      airline,
      crawlRunId,
      originIata: origin,
      destinationIata: destination,
      dateFrom,
      dateTo,
      force,
      adults,
      requestDelayMs,
      requestJitterMs,
      cooldownMs
    });
    res.json({
      ok: true,
      runId: handle.id,
      crawlRunId,
      traceId: uuidToTraceId(crawlRunId),
      publicAccessToken: handle.publicAccessToken,
      task: "crawl-pending-item",
      params: { airline, origin, destination, dateFrom, dateTo, force, adults, requestDelayMs, requestJitterMs, cooldownMs }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
app.post("/api/trigger/crawl-queue-worker", async (req, res) => {
  try {
    const airline = req.body?.airline === "EasyJet" ? "EasyJet" : "Ryanair";
    const crawlRunId = String(req.body?.runId ?? "").trim() || crypto.randomUUID();
    const maxIterations = Math.min(
      Math.max(1, Math.floor(Number(req.body?.maxIterations ?? 2500))),
      5e3
    );
    const adults = Math.max(1, Math.floor(Number(req.body?.adults ?? CRAWL_CONFIG.ryanair.adults)));
    const requestDelayMs = Math.max(
      0,
      Math.floor(Number(req.body?.requestDelayMs ?? CRAWL_CONFIG.ryanair.requestDelayMs))
    );
    const requestJitterMs = Math.max(
      0,
      Math.floor(Number(req.body?.requestJitterMs ?? CRAWL_CONFIG.ryanair.requestJitterMs))
    );
    const cooldownMs = Math.max(
      0,
      Math.floor(Number(req.body?.cooldownMs ?? CRAWL_CONFIG.ryanair.cooldownMs))
    );
    const handle = await tasks2.trigger("crawl-queue-worker", {
      airline,
      crawlRunId,
      maxIterations,
      adults,
      requestDelayMs,
      requestJitterMs,
      cooldownMs
    });
    res.json({
      ok: true,
      runId: handle.id,
      crawlRunId,
      traceId: uuidToTraceId(crawlRunId),
      publicAccessToken: handle.publicAccessToken,
      task: "crawl-queue-worker",
      params: { airline, maxIterations, adults, requestDelayMs, requestJitterMs, cooldownMs }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
app.get("/api/origins", async (req, res) => {
  try {
    const airline = String(req.query.airline ?? "").toUpperCase() || void 0;
    const { getClickHouse: getClickHouse2 } = await Promise.resolve().then(() => (init_clickhouse(), clickhouse_exports));
    const ch = getClickHouse2();
    const params = {};
    let filter = "";
    if (airline) {
      filter = "WHERE airline_code = {airline:String}";
      params.airline = airline;
    }
    const r = await ch.query({
      query: `
        SELECT origin_iata AS iata, count() AS n
        FROM airline_routes FINAL
        ${filter}
        GROUP BY origin_iata
        ORDER BY origin_iata
      `,
      query_params: params,
      format: "JSONEachRow"
    });
    const rows = await r.json();
    res.json({
      ok: true,
      airline,
      origins: rows.map((row) => ({
        iata: String(row.iata).toUpperCase(),
        destinations: Number(row.n)
      }))
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
app.get("/api/destinations", async (req, res) => {
  try {
    const originRaw = String(req.query.origin ?? "").trim().toUpperCase();
    const airline = String(req.query.airline ?? "").toUpperCase() || void 0;
    if (!/^[A-Z]{3}$/.test(originRaw)) {
      res.status(400).json({ ok: false, error: "origin must be a 3-letter IATA code" });
      return;
    }
    const { getClickHouse: getClickHouse2 } = await Promise.resolve().then(() => (init_clickhouse(), clickhouse_exports));
    const ch = getClickHouse2();
    const params = { origin: originRaw };
    let extra = "";
    if (airline) {
      extra = "AND airline_code = {airline:String}";
      params.airline = airline;
    }
    const r = await ch.query({
      query: `
        SELECT destination_iata AS iata, any(destination_name) AS name
        FROM airline_routes FINAL
        WHERE origin_iata = {origin:String}
        ${extra}
        GROUP BY destination_iata
        ORDER BY destination_iata
      `,
      query_params: params,
      format: "JSONEachRow"
    });
    const rows = await r.json();
    res.json({
      ok: true,
      origin: originRaw,
      airline,
      destinations: rows.map((row) => ({
        iata: String(row.iata).toUpperCase(),
        name: row.name ?? ""
      }))
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
app.get("/api/iatas", async (req, res) => {
  try {
    const airline = req.query.airline?.toUpperCase();
    const { getClickHouse: getClickHouse2 } = await Promise.resolve().then(() => (init_clickhouse(), clickhouse_exports));
    const ch = getClickHouse2();
    const result = await ch.query({
      query: `
        SELECT origin_iata AS iata FROM airline_routes FINAL WHERE origin_iata != ''
        ${airline ? "AND airline_code = {airline:String}" : ""}
        UNION DISTINCT
        SELECT destination_iata AS iata FROM airline_routes FINAL WHERE destination_iata != ''
        ${airline ? "AND airline_code = {airline:String}" : ""}
        ORDER BY iata
      `,
      query_params: airline ? { airline } : void 0,
      format: "JSONEachRow"
    });
    const rows = await result.json();
    res.json({ ok: true, iatas: rows.map((r) => r.iata.toUpperCase()) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
app.get("/api/queue/stats", async (req, res) => {
  try {
    const airlineRaw = String(req.query.airline ?? "Ryanair");
    if (airlineRaw !== "Ryanair" && airlineRaw !== "EasyJet") {
      res.status(400).json({ ok: false, error: `airline must be "Ryanair" or "EasyJet"` });
      return;
    }
    const { getQueueStats: getQueueStats2, listProgress: listProgress2 } = await Promise.resolve().then(() => (init_crawl_progress(), crawl_progress_exports));
    const stats = await getQueueStats2({ airline: airlineRaw });
    res.json({ ok: true, airline: airlineRaw, ...stats });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
app.get("/api/queue/items", async (req, res) => {
  try {
    const airlineRaw = String(req.query.airline ?? "Ryanair");
    if (airlineRaw !== "Ryanair" && airlineRaw !== "EasyJet") {
      res.status(400).json({ ok: false, error: `airline must be "Ryanair" or "EasyJet"` });
      return;
    }
    const statusRaw = String(req.query.status ?? "pending").toLowerCase();
    const validStatuses = /* @__PURE__ */ new Set(["pending", "processing", "completed", "failed"]);
    if (!validStatuses.has(statusRaw)) {
      res.status(400).json({
        ok: false,
        error: "status must be one of pending|processing|completed|failed"
      });
      return;
    }
    const limit = Math.min(Math.max(1, Number(req.query.limit ?? 200)), 1e3);
    const offset = Math.max(0, Math.floor(Number(req.query.offset ?? 0)));
    const originRaw = typeof req.query.origin === "string" ? req.query.origin.trim().toUpperCase() : "";
    const origin = /^[A-Z]{3}$/.test(originRaw) ? originRaw : "";
    const dateFrom = typeof req.query.dateFrom === "string" ? req.query.dateFrom : "";
    const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo : "";
    const { getClickHouse: getClickHouse2 } = await Promise.resolve().then(() => (init_clickhouse(), clickhouse_exports));
    const ch = getClickHouse2();
    const params = {
      airline: airlineRaw,
      limit,
      offset
    };
    const conditions = ["airline = {airline:String}", "status = {status:String}"];
    params.status = statusRaw;
    if (origin) {
      conditions.push("origin_iata = {origin:String}");
      params.origin = origin;
    }
    if (dateFrom) {
      conditions.push("date_from = {dateFrom:Date}");
      params.dateFrom = dateFrom;
    }
    if (dateTo) {
      conditions.push("date_to = {dateTo:Date}");
      params.dateTo = dateTo;
    }
    const orderBy = statusRaw === "pending" ? "ORDER BY inserted_at ASC" : "ORDER BY completed_at DESC, started_at DESC";
    const query = `
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
        if(started_at = toDateTime(0), '', formatDateTime(started_at, '%Y-%m-%dT%H:%i:%s.%fZ')) AS started_at,
        if(completed_at = toDateTime(0), '', formatDateTime(completed_at, '%Y-%m-%dT%H:%i:%s.%fZ')) AS completed_at,
        formatDateTime(inserted_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS inserted_at
      FROM crawl_progress_latest
      WHERE ${conditions.join(" AND ")}
      ${orderBy}
      LIMIT {limit:UInt32} OFFSET {offset:UInt32}
    `;
    const r = await ch.query({ query, query_params: params, format: "JSONEachRow" });
    const rows = await r.json();
    const items = rows.map((r2) => ({
      airline: r2.airline,
      origin: String(r2.origin_iata).toUpperCase(),
      destination: String(r2.destination_iata).toUpperCase(),
      dateFrom: String(r2.date_from).slice(0, 10),
      dateTo: String(r2.date_to).slice(0, 10),
      status: r2.status,
      crawlRunId: r2.crawl_run_id,
      traceId: r2.crawl_run_id ? uuidToTraceId(String(r2.crawl_run_id)) : "",
      rowsInserted: Number(r2.rows_inserted ?? 0),
      errorMessage: r2.error_message,
      startedAt: r2.started_at,
      completedAt: r2.completed_at,
      insertedAt: r2.inserted_at
    }));
    res.json({ ok: true, airline: airlineRaw, status: statusRaw, count: items.length, items });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
app.get("/api/queue/items-by-run", async (req, res) => {
  try {
    const crawlRunId = String(req.query.runId ?? "").trim();
    if (!crawlRunId) {
      res.status(400).json({ ok: false, error: "runId is required" });
      return;
    }
    const { getClickHouse: getClickHouse2 } = await Promise.resolve().then(() => (init_clickhouse(), clickhouse_exports));
    const ch = getClickHouse2();
    const r = await ch.query({
      query: `
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
          if(started_at = toDateTime(0), '', formatDateTime(started_at, '%Y-%m-%dT%H:%i:%s.%fZ')) AS started_at,
          if(completed_at = toDateTime(0), '', formatDateTime(completed_at, '%Y-%m-%dT%H:%i:%s.%fZ')) AS completed_at
        FROM crawl_progress_latest
        WHERE crawl_run_id = {runId:String}
        ORDER BY destination_iata
      `,
      query_params: { runId: crawlRunId },
      format: "JSONEachRow"
    });
    const rows = await r.json();
    res.json({
      ok: true,
      runId: crawlRunId,
      traceId: uuidToTraceId(crawlRunId),
      count: rows.length,
      items: rows.map((r2) => ({
        airline: r2.airline,
        origin: String(r2.origin_iata).toUpperCase(),
        destination: String(r2.destination_iata).toUpperCase(),
        dateFrom: String(r2.date_from).slice(0, 10),
        dateTo: String(r2.date_to).slice(0, 10),
        status: r2.status,
        crawlRunId: r2.crawl_run_id,
        rowsInserted: Number(r2.rows_inserted ?? 0),
        errorMessage: r2.error_message,
        startedAt: r2.started_at,
        completedAt: r2.completed_at
      }))
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
app.get("/api/runs/recent", async (req, res) => {
  try {
    const limit = Math.min(50, Number(req.query.limit ?? 20));
    const taskIdentifier = typeof req.query.task === "string" ? req.query.task : void 0;
    const list = await runs.list({ limit });
    const rawData = list.data ?? [];
    const data = taskIdentifier ? rawData.filter((r) => r.taskIdentifier === taskIdentifier) : rawData;
    const toIso = (v) => v == null ? null : v instanceof Date ? v.toISOString() : String(v);
    const summaries = data.slice(0, limit).map((r) => {
      const output = r.output ?? {};
      const payload = r.payload ?? {};
      const meta = r.metadata ?? {};
      return {
        id: r.id,
        taskIdentifier: r.taskIdentifier ?? null,
        status: r.status ?? null,
        isCompleted: Boolean(r.isCompleted),
        createdAt: toIso(r.createdAt),
        updatedAt: toIso(r.updatedAt),
        startedAt: toIso(r.startedAt),
        finishedAt: toIso(r.finishedAt),
        crawlRunId: payload?.crawlRunId ? String(payload.crawlRunId) : null,
        runId: payload?.runId ? String(payload.runId) : null,
        workerRunId: output?.workerRunId ? String(output.workerRunId) : null,
        currentOrigin: meta?.currentOrigin ? String(meta.currentOrigin) : null,
        currentDestination: meta?.currentDestination ? String(meta.currentDestination) : null
      };
    });
    res.json({ ok: true, count: summaries.length, runs: summaries });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
app.get("/api/runs", async (req, res) => {
  try {
    const limit = Math.min(50, Number(req.query.limit ?? 10));
    const list = await runs.list({ limit });
    res.json({ ok: true, runs: list.data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
app.get("/api/runs/active", async (_req, res) => {
  try {
    const list = await runs.list({ limit: 50 });
    const all = list.data ?? [];
    const toMs = (v) => {
      if (!v) return Number.MAX_SAFE_INTEGER;
      const d = v instanceof Date ? v : new Date(String(v));
      const t = d.getTime();
      return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
    };
    const executing = all.filter((r) => String(r.status ?? "").toUpperCase() === "EXECUTING").sort((a, b) => toMs(a.startedAt) - toMs(b.startedAt));
    const queued = all.filter((r) => String(r.status ?? "").toUpperCase() === "QUEUED").sort((a, b) => toMs(a.createdAt) - toMs(b.createdAt));
    res.json({
      ok: true,
      executing,
      queued,
      totals: { executing: executing.length, queued: queued.length }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
app.get("/api/runs/:runId", async (req, res) => {
  try {
    const run = await runs.retrieve(req.params.runId);
    res.json({ ok: true, run });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
app.post("/api/runs/:runId/cancel", async (req, res) => {
  try {
    const result = await runs.cancel(req.params.runId);
    res.json({ ok: true, runId: req.params.runId, status: result?.status ?? null });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
app.get("/api/otel/trace", async (req, res) => {
  try {
    const runIdRaw = String(req.query.runId ?? "").trim();
    const traceIdRaw = String(req.query.traceId ?? "").trim();
    let traceId = traceIdRaw;
    if (!traceId && runIdRaw) traceId = await resolveTraceId(runIdRaw);
    if (!traceId || !/^[a-f0-9]{8,32}$/.test(traceId)) {
      res.status(400).json({ ok: false, error: "valid runId (UUID) or traceId is required" });
      return;
    }
    const { getClickHouseForOtel: getClickHouseForOtel2 } = await Promise.resolve().then(() => (init_clickhouse(), clickhouse_exports));
    const ch = getClickHouseForOtel2();
    const minutes = Math.min(Math.max(1, Number(req.query.windowMinutes ?? 1440)), 60 * 24 * 30);
    const sinceIso = new Date(Date.now() - minutes * 6e4).toISOString().slice(0, 19).replace("T", " ");
    const [logsRes, spansRes, metricsRes] = await Promise.all([
      ch.query({
        query: `
          SELECT Timestamp, SeverityText, ServiceName, Body, LogAttributes, EventName, TraceId, SpanId
          FROM otel_logs
          WHERE TraceId = {traceId:String} AND Timestamp >= {since:DateTime}
          ORDER BY Timestamp ASC
          LIMIT 500
        `,
        query_params: { traceId, since: sinceIso },
        format: "JSONEachRow"
      }),
      ch.query({
        query: `
          SELECT Timestamp, SpanName, SpanKind, ServiceName, Duration, StatusCode, StatusMessage,
                 SpanAttributes, ParentSpanId, TraceId, SpanId
          FROM otel_traces
          WHERE TraceId = {traceId:String} AND Timestamp >= {since:DateTime}
          ORDER BY Timestamp ASC
          LIMIT 500
        `,
        query_params: { traceId, since: sinceIso },
        format: "JSONEachRow"
      }),
      ch.query({
        query: `
          SELECT TimeUnix, ServiceName, MetricName, MetricUnit, Value, Attributes
          FROM otel_metrics_gauge
          WHERE ServiceName != '' AND toUnixTimestamp(TimeUnix) >= toUnixTimestamp({since:DateTime})
          ORDER BY TimeUnix DESC
          LIMIT 25
        `,
        query_params: { since: sinceIso },
        format: "JSONEachRow"
      })
    ]);
    const logs = await logsRes.json();
    const spans = await spansRes.json();
    const metrics = await metricsRes.json();
    res.json({
      ok: true,
      runId: runIdRaw || null,
      traceId,
      hyperdx: hyperdxForTrace(traceId, minutes, runIdRaw),
      counts: { logs: logs.length, spans: spans.length, metrics: metrics.length },
      logs,
      spans,
      metrics
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
app.get("/api/otel/recent-traces", async (_req, res) => {
  try {
    const { getClickHouseForOtel: getClickHouseForOtel2 } = await Promise.resolve().then(() => (init_clickhouse(), clickhouse_exports));
    const ch = getClickHouseForOtel2();
    const r = await ch.query({
      query: `
        SELECT
          TraceId,
          min(Timestamp) AS started,
          max(Timestamp) AS ended,
          count() AS span_count,
          any(SpanName) AS root_span,
          any(ServiceName) AS service
        FROM otel_traces
        WHERE TraceId != ''
        GROUP BY TraceId
        ORDER BY started DESC
        LIMIT 30
      `,
      format: "JSONEachRow"
    });
    const rows = await r.json();
    res.json({
      ok: true,
      count: rows.length,
      traces: rows.map((row) => ({
        traceId: row.TraceId,
        started: row.started,
        ended: row.ended,
        spanCount: Number(row.span_count ?? 0),
        rootSpan: row.root_span,
        service: row.service,
        hyperdx: hyperdxForTrace(String(row.TraceId), 60 * 24 * 7)
      }))
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
function hyperdxForTrace(traceId, windowMinutes = 60 * 24 * 7, runIdHint) {
  const from = new Date(Date.now() - windowMinutes * 6e4).toISOString();
  const to = new Date(Date.now() + 6e4).toISOString();
  const search = `${HYPERDX_URL}/search?q=${encodeURIComponent(traceId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const session = `${HYPERDX_URL}/search/${encodeURIComponent(traceId)}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  return { search, session, traceId, runIdHint: runIdHint ?? null, windowMinutes };
}
function spawnScript(scriptRelPath, args) {
  const repoRoot = join3(import.meta.dirname, "..", "..");
  const scriptPath = join3(repoRoot, "scripts", scriptRelPath);
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["tsx", scriptPath, ...args], {
      cwd: repoRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const started = Date.now();
    child.stdout.on("data", (b) => {
      stdout += b.toString("utf8");
    });
    child.stderr.on("data", (b) => {
      stderr += b.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr, durationMs: Date.now() - started });
    });
  });
}
app.post("/api/scripts/backfill-crawl-progress", async (req, res) => {
  try {
    const mode = req.body?.mode === "mark-failed" ? "mark-failed" : "rows";
    const dryRun = Boolean(req.body?.dryRun);
    const errorMessage = String(
      req.body?.errorMessage ?? "Ryanair terms-of-use not accepted (backfilled)"
    );
    const args = ["--mode", mode];
    if (mode === "rows" && dryRun) args.push("--dry-run");
    if (mode === "mark-failed") args.push("--error-message", errorMessage);
    const result = await spawnScript("backfill-crawl-progress.ts", args);
    res.json({
      ok: result.code === 0,
      exitCode: result.code,
      durationMs: result.durationMs,
      params: { mode, dryRun, errorMessage },
      stdout: result.stdout,
      stderr: result.stderr
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
app.post("/api/scripts/manage-crawl-progress", async (req, res) => {
  try {
    const mode = (() => {
      if (req.body?.mode === "failed") return "failed";
      if (req.body?.mode === "requeue") return "requeue";
      return "list";
    })();
    const airline = String(req.body?.airline ?? "Ryanair");
    const origin = String(req.body?.origin ?? "").trim().toUpperCase();
    const dateFrom = String(req.body?.dateFrom ?? "");
    const dateTo = String(req.body?.dateTo ?? "");
    const destinations = parseIataList(req.body?.destinations ?? []);
    const includeCompleted = Boolean(req.body?.includeCompleted);
    if (airline !== "Ryanair" && airline !== "EasyJet") {
      res.status(400).json({ ok: false, error: `airline must be "Ryanair" or "EasyJet" (got "${airline}")` });
      return;
    }
    if (!origin || !dateFrom || !dateTo) {
      res.status(400).json({ ok: false, error: "origin, dateFrom and dateTo are required" });
      return;
    }
    const args = [
      `--${mode}`,
      "--airline",
      airline,
      "--origin",
      origin,
      "--from",
      dateFrom,
      "--to",
      dateTo
    ];
    if (destinations.length > 0) args.push("--dest", destinations.join(","));
    if (includeCompleted) args.push("--include-completed");
    const result = await spawnScript("manage-crawl-progress.ts", args);
    res.json({
      ok: result.code === 0,
      exitCode: result.code,
      durationMs: result.durationMs,
      params: { mode, airline, origin, dateFrom, dateTo, destinations, includeCompleted },
      stdout: result.stdout,
      stderr: result.stderr
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
app.post("/api/scripts/run-migrations", async (_req, res) => {
  try {
    const result = await spawnScript("run-migrations.ts", []);
    res.json({
      ok: result.code === 0,
      exitCode: result.code,
      durationMs: result.durationMs,
      stdout: result.stdout,
      stderr: result.stderr
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
app.post("/api/scripts/smoke-observability", async (_req, res) => {
  try {
    const result = await spawnScript("smoke-observability.ts", []);
    res.json({
      ok: result.code === 0,
      exitCode: result.code,
      durationMs: result.durationMs,
      stdout: result.stdout,
      stderr: result.stderr
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Frontend listening on http://localhost:${PORT}`);
  });
}
app.get("/api/map/airports", async (req, res) => {
  try {
    const airline = typeof req.query.airline === "string" && req.query.airline ? req.query.airline : "Ryanair";
    const { listAirportsForAirline: listAirportsForAirline2 } = await Promise.resolve().then(() => (init_airports(), airports_exports));
    const rows = await listAirportsForAirline2(airline);
    res.json({
      ok: true,
      airline,
      count: rows.length,
      airports: rows
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
app.get("/api/map/airports/search", async (req, res) => {
  try {
    const q = String(req.query.q ?? "");
    const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 25)));
    const { searchAirports: searchAirports2 } = await Promise.resolve().then(() => (init_airports(), airports_exports));
    const airports = searchAirports2(q, limit);
    res.json({ ok: true, query: q, count: airports.length, airports });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
app.get("/api/map/airports/:iata/fares", async (req, res) => {
  try {
    const iata = String(req.params.iata ?? "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(iata)) {
      res.status(400).json({ ok: false, error: "iata must be a 3-letter code" });
      return;
    }
    const airline = typeof req.query.airline === "string" && req.query.airline ? req.query.airline : void 0;
    const dateFrom = typeof req.query.dateFrom === "string" ? req.query.dateFrom : "";
    const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo : "";
    const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 200)));
    const { getAirport: getAirport2, listFaresForAirport: listFaresForAirport2 } = await Promise.resolve().then(() => (init_airports(), airports_exports));
    const airport = getAirport2(iata);
    const fares = await listFaresForAirport2({
      iata,
      airline,
      dateFrom: dateFrom || void 0,
      dateTo: dateTo || void 0,
      limit
    });
    res.json({
      ok: true,
      iata,
      airport,
      count: fares.length,
      fares
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
app.get("/api/map/fare-finder/cheapest-destinations", async (req, res) => {
  try {
    const origin = String(req.query.origin ?? "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(origin)) {
      res.status(400).json({ ok: false, error: "origin must be a 3-letter IATA" });
      return;
    }
    const dateFrom = String(req.query.dateFrom ?? "").trim();
    const dateTo = String(req.query.dateTo ?? "").trim();
    if (!dateFrom || !dateTo) {
      res.status(400).json({ ok: false, error: "dateFrom and dateTo are required" });
      return;
    }
    const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 12)));
    const airline = typeof req.query.airline === "string" ? req.query.airline : void 0;
    const airlineCode = typeof req.query.airlineCode === "string" ? req.query.airlineCode : void 0;
    const maxPrice = typeof req.query.maxPrice === "string" ? Number(req.query.maxPrice) : void 0;
    const { findCheapestDestinations: findCheapestDestinations2 } = await Promise.resolve().then(() => (init_fare_finder(), fare_finder_exports));
    const deals = await findCheapestDestinations2({ origin, dateFrom, dateTo, airline, airlineCode, maxPrice, limit });
    res.json({ ok: true, origin, window: { dateFrom, dateTo }, count: deals.length, destinations: deals });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
app.get("/api/map/fare-finder/cheapest-dates", async (req, res) => {
  try {
    const origin = String(req.query.origin ?? "").trim().toUpperCase();
    const destination = String(req.query.destination ?? "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination)) {
      res.status(400).json({ ok: false, error: "origin and destination must be 3-letter IATAs" });
      return;
    }
    const dateFrom = String(req.query.dateFrom ?? "").trim();
    const dateTo = String(req.query.dateTo ?? "").trim();
    if (!dateFrom || !dateTo) {
      res.status(400).json({ ok: false, error: "dateFrom and dateTo are required" });
      return;
    }
    const airlineCode = typeof req.query.airlineCode === "string" ? req.query.airlineCode : void 0;
    const limit = Math.min(120, Math.max(1, Number(req.query.limit ?? 60)));
    const { findCheapestDates: findCheapestDates2 } = await Promise.resolve().then(() => (init_fare_finder(), fare_finder_exports));
    const cells = await findCheapestDates2({ origin, destination, dateFrom, dateTo, airlineCode, limit });
    res.json({ ok: true, origin, destination, window: { dateFrom, dateTo }, count: cells.length, cells });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
app.get("/api/map/fare-finder/best-round-trip", async (req, res) => {
  try {
    const origin = String(req.query.origin ?? "").trim().toUpperCase();
    const destination = String(req.query.destination ?? "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination)) {
      res.status(400).json({ ok: false, error: "origin and destination must be 3-letter IATAs" });
      return;
    }
    const dateFrom = String(req.query.dateFrom ?? "").trim();
    const dateTo = String(req.query.dateTo ?? "").trim();
    if (!dateFrom || !dateTo) {
      res.status(400).json({ ok: false, error: "dateFrom and dateTo are required" });
      return;
    }
    const minDays = Math.min(60, Math.max(1, Number(req.query.minDays ?? 3)));
    const maxDays = Math.min(60, Math.max(minDays, Number(req.query.maxDays ?? 14)));
    const airlineCode = typeof req.query.airlineCode === "string" ? req.query.airlineCode : void 0;
    const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 5)));
    const { findBestRoundTrip: findBestRoundTrip2 } = await Promise.resolve().then(() => (init_fare_finder(), fare_finder_exports));
    const bundles = await findBestRoundTrip2({ origin, destination, dateFrom, dateTo, minDays, maxDays, airlineCode, limit });
    res.json({ ok: true, origin, destination, window: { dateFrom, dateTo, minDays, maxDays }, count: bundles.length, options: bundles });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
app.get("/api/map/fare-finder/best-one-way", async (req, res) => {
  try {
    const origin = String(req.query.origin ?? "").trim().toUpperCase();
    const destination = String(req.query.destination ?? "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination)) {
      res.status(400).json({ ok: false, error: "origin and destination must be 3-letter IATAs" });
      return;
    }
    const dateFrom = String(req.query.dateFrom ?? "").trim();
    const dateTo = String(req.query.dateTo ?? "").trim();
    if (!dateFrom || !dateTo) {
      res.status(400).json({ ok: false, error: "dateFrom and dateTo are required" });
      return;
    }
    const airlineCode = typeof req.query.airlineCode === "string" ? req.query.airlineCode : void 0;
    const limit = Math.min(60, Math.max(1, Number(req.query.limit ?? 10)));
    const { findBestOneWay: findBestOneWay2 } = await Promise.resolve().then(() => (init_fare_finder(), fare_finder_exports));
    const fares = await findBestOneWay2({ origin, destination, dateFrom, dateTo, airlineCode, limit });
    res.json({ ok: true, origin, destination, count: fares.length, fares });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
app.post("/api/map/fare-finder/cheapest-from-any", async (req, res) => {
  try {
    const originsRaw = Array.isArray(req.body?.origins) ? req.body.origins : null;
    if (!originsRaw || originsRaw.length < 1 || originsRaw.length > 8) {
      res.status(400).json({ ok: false, error: "origins must be a 1-8 item array of 3-letter IATAs" });
      return;
    }
    const origins = originsRaw.map((s) => String(s).trim().toUpperCase()).filter((s) => /^[A-Z]{3}$/.test(s));
    if (origins.length === 0) {
      res.status(400).json({ ok: false, error: "origins contains no valid IATAs" });
      return;
    }
    const dateFrom = String(req.body?.dateFrom ?? "").trim();
    const dateTo = String(req.body?.dateTo ?? "").trim();
    if (!dateFrom || !dateTo) {
      res.status(400).json({ ok: false, error: "dateFrom and dateTo are required" });
      return;
    }
    const destination = typeof req.body?.destination === "string" && req.body.destination ? String(req.body.destination).trim().toUpperCase() : void 0;
    const limit = Math.min(50, Math.max(1, Number(req.body?.limit ?? 10)));
    const { findCheapestFromAnyOrigin: findCheapestFromAnyOrigin2 } = await Promise.resolve().then(() => (init_fare_finder(), fare_finder_exports));
    const deals = await findCheapestFromAnyOrigin2({ origins, destination, dateFrom, dateTo, limit });
    res.json({ ok: true, origins, window: { dateFrom, dateTo }, count: deals.length, destinations: deals });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
app.get("/api/map/fare-finder/weekend-deals", async (req, res) => {
  try {
    const origin = String(req.query.origin ?? "").trim().toUpperCase();
    const destination = String(req.query.destination ?? "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination)) {
      res.status(400).json({ ok: false, error: "origin and destination must be 3-letter IATAs" });
      return;
    }
    const dateFrom = String(req.query.dateFrom ?? "").trim();
    const dateTo = String(req.query.dateTo ?? "").trim();
    if (!dateFrom || !dateTo) {
      res.status(400).json({ ok: false, error: "dateFrom and dateTo are required" });
      return;
    }
    const nights = Math.min(21, Math.max(1, Number(req.query.nights ?? 4)));
    const airlineCode = typeof req.query.airlineCode === "string" ? req.query.airlineCode : void 0;
    const limit = Math.min(20, Math.max(1, Number(req.query.limit ?? 5)));
    const { findWeekendDeals: findWeekendDeals2 } = await Promise.resolve().then(() => (init_fare_finder(), fare_finder_exports));
    const bundles = await findWeekendDeals2({ origin, destination, dateFrom, dateTo, nightCount: nights, airlineCode, limit });
    res.json({ ok: true, origin, destination, window: { dateFrom, dateTo, nights }, count: bundles.length, options: bundles });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
app.get("/api/map/fare-finder/freshness", async (_req, res) => {
  try {
    const { getDatasetFreshness: getDatasetFreshness2, buildToolHints: buildToolHints2 } = await Promise.resolve().then(() => (init_fare_finder(), fare_finder_exports));
    const f = await getDatasetFreshness2();
    res.json({ ok: true, ...f, hints: buildToolHints2(f) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
app.post("/api/map/itinerary/generate", async (req, res) => {
  try {
    const prompt = String(req.body?.prompt ?? "").trim();
    const homeIata = String(req.body?.homeIata ?? "MLA").trim().toUpperCase();
    const dateFrom = String(req.body?.dateFrom ?? nextMonthStartIso());
    const dateTo = String(req.body?.dateTo ?? monthAfterNextStartIso());
    const daysPerCountry = Math.max(1, Math.floor(Number(req.body?.daysPerCountry ?? 3)));
    const preferredAirlines = Array.isArray(req.body?.preferredAirlines) ? req.body.preferredAirlines.map((s) => String(s)).filter(Boolean) : [];
    const maxItineraries = Math.min(8, Math.max(1, Math.floor(Number(req.body?.maxItineraries ?? 4))));
    const destinations = Array.isArray(req.body?.destinations) ? req.body.destinations.map((s) => String(s).toUpperCase()).filter((s) => /^[A-Z]{3}$/.test(s)) : [];
    const plannerRaw = String(req.body?.planner ?? "sql").toLowerCase();
    const planner = plannerRaw === "legacy" ? "legacy" : "sql";
    if (!prompt && destinations.length === 0) {
      res.status(400).json({ ok: false, error: "prompt or destinations[] is required" });
      return;
    }
    if (!/^[A-Z]{3}$/.test(homeIata)) {
      res.status(400).json({ ok: false, error: "homeIata must be a 3-letter IATA code" });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
      res.status(400).json({ ok: false, error: "dateFrom and dateTo must be YYYY-MM-DD" });
      return;
    }
    const { getAirport: getAirport2 } = await Promise.resolve().then(() => (init_airports(), airports_exports));
    let itineraries;
    if (planner === "sql" && destinations.length >= 1) {
      const { planBestItinerary: planBestItinerary2 } = await Promise.resolve().then(() => (init_itinerary_planner(), itinerary_planner_exports));
      const sqlResults = await planBestItinerary2({
        home: homeIata,
        stops: destinations,
        dateFrom,
        dateTo,
        bufferDays: daysPerCountry,
        preferredAirlines,
        topK: maxItineraries
      });
      itineraries = sqlResults.map((it) => ({
        id: it.permutation.join("-") + "-" + it.legs[0]?.date + "-" + it.legs.at(-1)?.date,
        title: `${homeIata} \u2192 ${it.permutation.join(" \u2192 ")} \u2192 ${homeIata}`,
        totalPrice: it.totalPrice,
        currency: it.currency,
        totalDurationMinutes: it.totalDurationMinutes,
        legs: it.legs.map((leg) => ({
          origin: leg.origin,
          destination: leg.destination,
          date: leg.date,
          departureDatetime: leg.departureDatetime,
          arrivalDatetime: leg.arrivalDatetime,
          price: leg.price,
          currency: leg.currency,
          airline: leg.airline,
          durationMinutes: leg.durationMinutes,
          originAirport: getAirport2(leg.origin),
          destinationAirport: getAirport2(leg.destination)
        })),
        summary: `Cheapest valid itinerary across ${destinations.length} stops. Total flight time: ${it.totalDurationMinutes ?? "\u2014"} min.`,
        recommendationScore: Math.max(0, Math.round(100 - it.totalPrice))
      }));
    } else {
      const { generateItineraries: generateItineraries3 } = await Promise.resolve().then(() => (init_itinerary(), itinerary_exports));
      const legacy = await generateItineraries3({
        prompt: prompt || void 0,
        homeIata,
        dateFrom,
        dateTo,
        daysPerCountry,
        preferredAirlines,
        maxItineraries,
        destinations
      });
      itineraries = legacy.map((it) => ({
        ...it,
        legs: it.legs.map((leg) => ({
          ...leg,
          originAirport: getAirport2(leg.origin),
          destinationAirport: getAirport2(leg.destination)
        }))
      }));
    }
    res.json({
      ok: true,
      planner,
      request: {
        prompt,
        homeIata,
        dateFrom,
        dateTo,
        daysPerCountry,
        preferredAirlines,
        destinations,
        maxItineraries
      },
      count: itineraries.length,
      itineraries
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
app.get("/api/map/itinerary/favorites", async (_req, res) => {
  try {
    const { listFavorites: listFavorites2 } = await Promise.resolve().then(() => (init_itinerary(), itinerary_exports));
    res.json({ ok: true, count: listFavorites2().length, favorites: listFavorites2() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
app.post("/api/map/itinerary/favorites", async (req, res) => {
  try {
    const itinerary = req.body?.itinerary;
    if (!itinerary || !itinerary.id || !Array.isArray(itinerary.legs)) {
      res.status(400).json({ ok: false, error: "itinerary { id, legs, ... } is required" });
      return;
    }
    const { saveFavorite: saveFavorite2 } = await Promise.resolve().then(() => (init_itinerary(), itinerary_exports));
    const fav = saveFavorite2(itinerary);
    res.json({ ok: true, favorite: fav });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
app.delete("/api/map/itinerary/favorites/:id", async (req, res) => {
  try {
    const { removeFavorite: removeFavorite2 } = await Promise.resolve().then(() => (init_itinerary(), itinerary_exports));
    const ok = removeFavorite2(req.params.id);
    res.json({ ok, removed: ok });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
app.get("/api/tools", async (_req, res) => {
  try {
    const { listTools: listTools2 } = await Promise.resolve().then(() => (init_registry(), registry_exports));
    const tools = listTools2().map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      parameters: t.parameters
    }));
    res.json({ ok: true, count: tools.length, tools });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
app.post("/api/llm/byok", async (_req, res) => {
  res.status(410).json({ ok: false, error: "BYOK is disabled. All chat is routed through our hosted LLM keys." });
});
app.delete("/api/llm/byok", async (_req, res) => {
  res.status(410).json({ ok: false, error: "BYOK is disabled. All chat is routed through our hosted LLM keys." });
});
app.get("/api/llm/status", async (_req, res) => {
  try {
    const { resolveCredentials: resolveCredentials2 } = await Promise.resolve().then(() => (init_key_vault(), key_vault_exports));
    const creds = resolveCredentials2();
    res.json({
      ok: true,
      configured: Boolean(creds.apiKey),
      source: creds.source === "none" ? "none" : "hosted",
      provider: creds.apiKey ? creds.provider : null,
      model: creds.apiKey ? creds.model ?? null : null
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
function sseHeaders(res) {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
}
function sseSend(res, event, data) {
  res.write(`event: ${event}
`);
  res.write(`data: ${JSON.stringify(data)}

`);
}
var TRIGGER_TERMINAL = /* @__PURE__ */ new Set([
  "COMPLETED",
  "FAILED",
  "CANCELED",
  "CANCELLED",
  "CRASHED",
  "SYSTEM_FAILURE",
  "EXPIRED",
  "TIMED_OUT"
]);
async function pollRunUntilTerminal(runId, res, abort) {
  let lastStatus = null;
  for (let i = 0; i < 600; i++) {
    if (abort.aborted) return;
    try {
      const run = await runs.retrieve(runId);
      const status = String(run.status ?? "UNKNOWN");
      const payload = {
        runId,
        status,
        taskIdentifier: run.taskIdentifier ?? null,
        startedAt: run.startedAt ?? null,
        finishedAt: run.finishedAt ?? null,
        costInCents: run.costInCents ?? null,
        durationMs: run.durationMs ?? null
      };
      if (status !== lastStatus) {
        sseSend(res, "run_status", payload);
        lastStatus = status;
      } else if (i % 5 === 0) {
        sseSend(res, "run_status", payload);
      }
      if (TRIGGER_TERMINAL.has(status.toUpperCase())) {
        sseSend(res, "run_final", { runId, status, output: run.output ?? null, error: run.error ?? null });
        return;
      }
    } catch (err) {
      sseSend(res, "run_status", { runId, status: "ERROR", error: err.message });
    }
    await new Promise((r) => setTimeout(r, 2e3));
  }
  sseSend(res, "run_final", { runId, status: "TIMEOUT", error: "frontend-stopped-watching" });
}
app.post("/api/llm/chat", async (req, res) => {
  try {
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : null;
    if (!messages || messages.length === 0) {
      res.status(400).json({ ok: false, error: "messages[] is required" });
      return;
    }
    sseHeaders(res);
    const ac = new AbortController();
    req.on("close", () => ac.abort());
    res.on("close", () => ac.abort());
    const runPollers = [];
    const { resolveCredentials: resolveCredentials2 } = await Promise.resolve().then(() => (init_key_vault(), key_vault_exports));
    const { runLlmAgent: runLlmAgent2 } = await Promise.resolve().then(() => (init_client(), client_exports));
    const creds = resolveCredentials2();
    const result = await runLlmAgent2(
      {
        messages,
        model: req.body?.model,
        maxIterations: req.body?.maxIterations
      },
      { provider: creds.provider, apiKey: creds.apiKey, model: creds.model },
      (event) => {
        const map = {
          status: "status",
          assistant_delta: "assistant_delta",
          tool_call: "tool_call",
          tool_result: "tool_result",
          assistant_message: "assistant_message",
          run_triggered: "run_triggered",
          error: "error",
          done: "done"
        };
        const ev = map[event.type] ?? "agent";
        sseSend(res, ev, event);
        if (event.type === "run_triggered" && typeof event.runId === "string") {
          runPollers.push(pollRunUntilTerminal(event.runId, res, ac.signal));
        }
      }
    );
    await Promise.allSettled(runPollers);
    sseSend(res, "final", { ok: result.ok, content: result.content, iterations: result.iterations, error: result.error ?? null, provider: result.provider, model: result.model });
    res.end();
  } catch (err) {
    try {
      sseSend(res, "error", { error: err.message });
      res.end();
    } catch {
    }
  }
});
app.get("/api/runs/:runId/stream", async (req, res) => {
  try {
    const runId = String(req.params.runId ?? "").trim();
    if (!runId) {
      res.status(400).json({ ok: false, error: "runId is required" });
      return;
    }
    sseHeaders(res);
    const ac = new AbortController();
    req.on("close", () => ac.abort());
    res.on("close", () => ac.abort());
    await pollRunUntilTerminal(runId, res, ac.signal);
    res.end();
  } catch (err) {
    try {
      sseSend(res, "error", { error: err.message });
      res.end();
    } catch {
    }
  }
});
app.post("/api/tools/:id", async (req, res) => {
  try {
    const { getTool: getTool3 } = await Promise.resolve().then(() => (init_registry(), registry_exports));
    const tool = getTool3(req.params.id);
    if (!tool) {
      res.status(404).json({ ok: false, error: `unknown tool: ${req.params.id}` });
      return;
    }
    const parsed = tool.schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: "invalid parameters", issues: parsed.error.issues });
      return;
    }
    const result = await tool.handler(parsed.data);
    res.json({ ok: true, tool: tool.id, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
app.post("/api/map/round-trip", async (req, res) => {
  try {
    const origin = String(req.body?.origin ?? "").trim().toUpperCase();
    const destination = String(req.body?.destination ?? "").trim().toUpperCase();
    const dateFrom = String(req.body?.dateFrom ?? "");
    const dateTo = String(req.body?.dateTo ?? "");
    const minDays = req.body?.minDays != null ? Math.max(1, Math.floor(Number(req.body.minDays))) : void 0;
    const maxDays = req.body?.maxDays != null ? Math.max(1, Math.floor(Number(req.body.maxDays))) : void 0;
    const limit = req.body?.limit != null ? Math.min(20, Math.max(1, Math.floor(Number(req.body.limit)))) : 5;
    if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination)) {
      res.status(400).json({ ok: false, error: "origin and destination must be 3-letter IATA codes" });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
      res.status(400).json({ ok: false, error: "dateFrom and dateTo must be YYYY-MM-DD" });
      return;
    }
    if (origin === destination) {
      res.status(400).json({ ok: false, error: "origin and destination must differ" });
      return;
    }
    const { findCheapestRoundTrip: findCheapestRoundTrip2, getAirport: getAirport2 } = await Promise.resolve().then(() => (init_airports(), airports_exports));
    const trips = await findCheapestRoundTrip2({ origin, destination, dateFrom, dateTo, minDays, maxDays });
    const options = trips.slice(0, limit).map((t) => ({
      ...t,
      originAirport: getAirport2(t.origin),
      destinationAirport: getAirport2(t.destination)
    }));
    res.json({
      ok: true,
      origin,
      destination,
      count: options.length,
      options
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
app.post("/api/map/itinerary/refresh-crawl", async (req, res) => {
  try {
    const legs = Array.isArray(req.body?.legs) ? req.body.legs : [];
    if (legs.length === 0) {
      res.status(400).json({ ok: false, error: "legs array is required" });
      return;
    }
    const crawlRunId = String(req.body?.runId ?? crypto.randomUUID());
    const airline = req.body?.airline === "EasyJet" ? "EasyJet" : "Ryanair";
    const triggers = [];
    for (const leg of legs) {
      const origin = String(leg.origin ?? "").trim().toUpperCase();
      const destination = String(leg.destination ?? "").trim().toUpperCase();
      const dateFrom = String(leg.date ?? nextMonthStartIso());
      const dateTo = String(leg.dateTo ?? monthAfterNextStartIso());
      if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination)) continue;
      triggers.push({ origin, destination, dateFrom, dateTo });
    }
    if (triggers.length === 0) {
      res.status(400).json({ ok: false, error: "no valid legs to crawl" });
      return;
    }
    const { enqueuePendingRoutes: enqueuePendingRoutes2 } = await Promise.resolve().then(() => (init_crawl_progress(), crawl_progress_exports));
    const allOrigins = Array.from(new Set(triggers.map((t) => t.origin)));
    const firstLeg = triggers[0];
    if (!firstLeg) {
      res.status(400).json({ ok: false, error: "no legs to crawl" });
      return;
    }
    const enqueue = await enqueuePendingRoutes2({
      airline,
      origins: allOrigins,
      dateFrom: firstLeg.dateFrom,
      dateTo: firstLeg.dateTo,
      crawlRunId
    });
    const handle = await tasks2.trigger("crawl-queue-worker", {
      airline,
      crawlRunId,
      maxIterations: triggers.length * 2
    });
    res.json({
      ok: true,
      crawlRunId,
      traceId: uuidToTraceId(crawlRunId),
      runId: handle.id,
      task: "crawl-queue-worker",
      enqueued: enqueue.enqueued,
      alreadyPending: enqueue.already_pending,
      legsQueued: triggers.length,
      legs: triggers
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
export {
  app
};
