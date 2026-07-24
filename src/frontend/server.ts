if (!process.env.VERCEL) {
  try {
    import("dotenv/config");
  } catch {
    // dotenv only needed for local dev; ignore if unavailable.
  }
}

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import express from "express";

import { runs, tasks } from "@trigger.dev/sdk";
import { AgentChat } from "@trigger.dev/sdk/chat";

import { listTaskDescriptions } from "../trigger/task-descriptions.js";
import { logger } from "../lib/logger.js";
import { CRAWL_CONFIG } from "../config/crawl.js";
import { RYANAIR_DEFAULT_BASES } from "../airlines/ryanair.js";
import { newTraceId } from "../observability/ids.js";

const PORT = Number(process.env.FRONTEND_PORT ?? 3030);
const HYPERDX_URL = (process.env.HYPERDX_URL ?? "http://localhost:8090").replace(/\/$/, "");

const log = logger("src/frontend/server.ts");

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type?: string;
    name?: string;
    arguments?: string;
    function?: { name?: string; arguments?: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

interface SessionParameters {
  origin?: string;
  destination?: string;
  dateFrom?: string;
  dateTo?: string;
  passengers?: number;
  maxPrice?: number;
  [key: string]: unknown;
}

interface ChatSession {
  id: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  parameters: SessionParameters;
}

const chatSessions = new Map<string, ChatSession>();
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [id, session] of chatSessions) {
    if (now - session.updatedAt > SESSION_TTL_MS) {
      chatSessions.delete(id);
    }
  }
}
setInterval(cleanupExpiredSessions, 60 * 60 * 1000);

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    res.setHeader("Cache-Control", "no-store");
  }
  next();
});
app.use(express.static(join(import.meta.dirname, "..", "..", "public")));

app.use((req, res, next) => {
  const startedAt = Date.now();
  const bodyBytes = req.headers["content-length"] ? Number(req.headers["content-length"]) : 0;
  log.info(">>> request enter", {
    method: req.method,
    path: req.originalUrl,
    ip: req.ip ?? req.socket.remoteAddress,
    bytes: bodyBytes,
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
      durationMs,
    };
    if (status >= 500) log.error("<<< request exit", meta);
    else if (status >= 400) log.warn("<<< request exit", meta);
    else log.info("<<< request exit", meta);
  };

  res.on("finish", finalize);
  res.on("close", finalize);
  next();
});

app.get("/", (_req, res) => {
  res.sendFile(join(import.meta.dirname, "..", "..", "public", "map.html"));
});

app.get("/admin", (_req, res) => {
  res.sendFile(join(import.meta.dirname, "index.html"));
});

app.post("/api/sessions", (req, res) => {
  const id = crypto.randomUUID();
  const session: ChatSession = {
    id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
    parameters: (req.body?.parameters as SessionParameters) || {},
  };
  chatSessions.set(id, session);
  res.json({ ok: true, session: { id, createdAt: session.createdAt, parameters: session.parameters } });
});

app.get("/api/sessions/:id", (req, res) => {
  const session = chatSessions.get(String(req.params.id));
  if (!session) { res.status(404).json({ ok: false, error: "session not found" }); return; }
  res.json({ ok: true, session: { id: session.id, createdAt: session.createdAt, updatedAt: session.updatedAt, messages: session.messages, parameters: session.parameters } });
});

app.delete("/api/sessions/:id", (req, res) => {
  const id = String(req.params.id);
  if (!chatSessions.has(id)) { res.status(404).json({ ok: false, error: "session not found" }); return; }
  chatSessions.delete(id);
  res.json({ ok: true });
});

function parseIataList(input: unknown): string[] {
  if (!Array.isArray(input)) {
    if (typeof input === "string") {
      return input
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter((s) => /^[A-Z]{3}$/.test(s));
    }
    return [];
  }
  return input
    .map((s) => String(s).trim().toUpperCase())
    .filter((s) => /^[A-Z]{3}$/.test(s));
}

function nextMonthStartIso(): string {
  const d = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1));
  return d.toISOString().slice(0, 10);
}

function monthAfterNextStartIso(): string {
  const d = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 2, 1));
  return d.toISOString().slice(0, 10);
}

function uuidToTraceId(runId: string): string {
  return newTraceId(runId);
}

async function resolveTraceId(runIdRaw: string): Promise<string> {
  if (runIdRaw.startsWith("run_")) {
    const run = await runs.retrieve(runIdRaw);
    const payload = run.payload as Record<string, unknown> | undefined;
    const crawlRunId = payload?.crawlRunId as string | undefined;
    if (!crawlRunId) throw new Error(`No crawlRunId in run payload for ${runIdRaw}`);
    return newTraceId(crawlRunId);
  }
  return newTraceId(runIdRaw);
}



app.get("/api/health", async (_req, res) => {
  try {
    const { pingClickHouse, getClickHouseForOtel } = await import("../db/clickhouse.js");
    const flights = await pingClickHouse();
    let otel = false;
    try {
      const ch = getClickHouseForOtel();
      const r = await ch.ping();
      otel = Boolean(r.success);
    } catch {
      otel = false;
    }
    res.json({
      ok: true,
      ts: new Date().toISOString(),
      clickhouse: { flights, otel },
      hyperdx: { url: HYPERDX_URL },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
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
      defaultBases: RYANAIR_DEFAULT_BASES,
    },
    frontend: { port: PORT },
    hyperdx: { url: HYPERDX_URL },
    server: { version: readPackageVersion(), pid: process.pid, startedAt: new Date().toISOString() },
  });
});

function readPackageVersion(): string {
  try {
    const raw = readFileSync(join(import.meta.dirname, "..", "..", "package.json"), "utf8");
    return (JSON.parse(raw) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

app.post("/api/trigger/sync-ryanair-routes", async (req, res) => {
  try {
    const source: "dynamic" | "bases" = req.body?.source === "bases" ? "bases" : "dynamic";
    const concurrency = Math.min(
      20,
      Math.max(1, Math.floor(Number(req.body?.concurrency ?? 1)))
    );

    if (source === "dynamic") {
      const handle = await tasks.trigger<
        typeof import("../trigger/sync-ryanair-routes.js").syncRyanairRoutes
      >("sync-ryanair-routes", { concurrency });
      res.json({
        ok: true,
        runId: handle.id,
        publicAccessToken: handle.publicAccessToken,
        task: "sync-ryanair-routes",
        params: { source, concurrency },
      });
      return;
    }

    const origins = parseIataList(req.body?.origins ?? []);
    const envOrigins = parseIataList(process.env.RYANAIR_ORIGINS);
    const finalOrigins =
      origins.length > 0 ? origins : envOrigins.length > 0 ? envOrigins : undefined;
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
      stderr: result.stderr,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.post("/api/trigger/full-scan", async (req, res) => {
  try {
    const dateFrom: string = req.body?.dateFrom ?? nextMonthStartIso();
    const dateTo: string = req.body?.dateTo ?? monthAfterNextStartIso();
    const requestedOrigins = parseIataList(req.body?.origins ?? []);
    const envOrigins = parseIataList(process.env.RYANAIR_ORIGINS);
    const origins = requestedOrigins.length > 0 ? requestedOrigins : envOrigins;
    const crawlRunId: string = req.body?.runId || crypto.randomUUID();
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
    const maxIterations: number = Math.min(
      Math.max(1, Math.floor(Number(req.body?.maxIterations ?? 2500))),
      5000
    );

    if (origins.length === 0) {
      res.status(400).json({
        ok: false,
        error: "origins must be provided in the request or RYANAIR_ORIGINS",
      });
      return;
    }

    const { enqueuePendingRoutes } = await import("../db/crawl-progress.js");
    const enqueueResult = await enqueuePendingRoutes({
      airline: "Ryanair",
      origins,
      dateFrom,
      dateTo,
      crawlRunId,
    });

    const handle = await tasks.trigger<
      typeof import("../trigger/crawl-queue-worker.js").crawlQueueWorker
    >("crawl-queue-worker", {
      airline: "Ryanair",
      crawlRunId,
      maxIterations,
      adults,
      requestDelayMs,
      requestJitterMs,
      cooldownMs,
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
        maxIterations,
      },
      hyperdx: { url: `${HYPERDX_URL}/search` },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.post("/api/trigger/single-origin", async (req, res) => {
  try {
    const origin: string = String(req.body?.origin ?? "").trim().toUpperCase();
    const dateFrom: string = req.body?.dateFrom ?? nextMonthStartIso();
    const dateTo: string = req.body?.dateTo ?? monthAfterNextStartIso();
    const destinations =
      req.body?.destinations != null ? parseIataList(req.body.destinations) : undefined;
    const crawlRunId: string = req.body?.runId || crypto.randomUUID();
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
    const maxIterations: number = Math.min(
      Math.max(1, Math.floor(Number(req.body?.maxIterations ?? 2500))),
      5000
    );

    if (!/^[A-Z]{3}$/.test(origin)) {
      res.status(400).json({ ok: false, error: "origin must be a 3-letter IATA code" });
      return;
    }

    const { enqueuePendingRoutes } = await import("../db/crawl-progress.js");
    const enqueueResult = await enqueuePendingRoutes({
      airline: "Ryanair",
      origins: [origin],
      dateFrom,
      dateTo,
      crawlRunId,
    });

    const handle = await tasks.trigger<
      typeof import("../trigger/crawl-queue-worker.js").crawlQueueWorker
    >("crawl-queue-worker", {
      airline: "Ryanair",
      crawlRunId,
      maxIterations,
      adults,
      requestDelayMs,
      requestJitterMs,
      cooldownMs,
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
        maxIterations,
      },
      hyperdx: { url: `${HYPERDX_URL}/search` },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.post("/api/trigger/seed-queue", async (req, res) => {
  try {
    const airline = (req.body?.airline ?? "Ryanair") as "Ryanair" | "EasyJet";
    const origins = parseIataList(req.body?.origins ?? []);
    const dateFrom: string = req.body?.dateFrom ?? nextMonthStartIso();
    const dateTo: string = req.body?.dateTo ?? monthAfterNextStartIso();
    const maxIterations: number = Math.min(Math.max(1, Math.floor(Number(req.body?.maxIterations ?? 100))), 1000);
    const adults: number = Math.max(1, Math.floor(Number(req.body?.adults ?? CRAWL_CONFIG.ryanair.adults)));
    const requestDelayMs: number = Math.max(
      0,
      Math.floor(Number(req.body?.requestDelayMs ?? CRAWL_CONFIG.ryanair.requestDelayMs))
    );
    const requestJitterMs: number = Math.max(
      0,
      Math.floor(Number(req.body?.requestJitterMs ?? CRAWL_CONFIG.ryanair.requestJitterMs))
    );
    const cooldownMs: number = Math.max(0, Math.floor(Number(req.body?.cooldownMs ?? CRAWL_CONFIG.ryanair.cooldownMs)));

    if (origins.length === 0) {
      res.status(400).json({ ok: false, error: "origins array is required" });
      return;
    }

    const crawlRunId: string = req.body?.runId || crypto.randomUUID();

    const { enqueuePendingRoutes } = await import("../db/crawl-progress.js");
    const enqueueResult = await enqueuePendingRoutes({
      airline,
      origins,
      dateFrom,
      dateTo,
      crawlRunId,
    });

    const handle = await tasks.trigger<
      typeof import("../trigger/crawl-queue-worker.js").crawlQueueWorker
    >("crawl-queue-worker", {
      airline,
      crawlRunId,
      maxIterations,
      adults,
      requestDelayMs,
      requestJitterMs,
      cooldownMs,
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
      params: { airline, origins, dateFrom, dateTo, maxIterations, adults, requestDelayMs, requestJitterMs, cooldownMs },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.post("/api/trigger/crawl-pending-item", async (req, res) => {
  try {
    const airline: "Ryanair" | "EasyJet" = req.body?.airline === "EasyJet" ? "EasyJet" : "Ryanair";
    const origin = String(req.body?.origin ?? "").trim().toUpperCase();
    const destination = String(req.body?.destination ?? "").trim().toUpperCase();
    const dateFrom: string = req.body?.dateFrom ?? nextMonthStartIso();
    const dateTo: string = req.body?.dateTo ?? monthAfterNextStartIso();
    const crawlRunId: string = req.body?.runId || crypto.randomUUID();
    const force: boolean = Boolean(req.body?.force);
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

    const handle = await tasks.trigger<
      typeof import("../trigger/crawl-pending-item.js").crawlPendingItem
    >("crawl-pending-item", {
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
      cooldownMs,
    });

    res.json({
      ok: true,
      runId: handle.id,
      crawlRunId,
      traceId: uuidToTraceId(crawlRunId),
      publicAccessToken: handle.publicAccessToken,
      task: "crawl-pending-item",
      params: { airline, origin, destination, dateFrom, dateTo, force, adults, requestDelayMs, requestJitterMs, cooldownMs },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.post("/api/trigger/crawl-queue-worker", async (req, res) => {
  try {
    const airline: "Ryanair" | "EasyJet" = req.body?.airline === "EasyJet" ? "EasyJet" : "Ryanair";
    const crawlRunId: string = String(req.body?.runId ?? "").trim() || crypto.randomUUID();
    const maxIterations: number = Math.min(
      Math.max(1, Math.floor(Number(req.body?.maxIterations ?? 2500))),
      5000
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

    const handle = await tasks.trigger<
      typeof import("../trigger/crawl-queue-worker.js").crawlQueueWorker
    >("crawl-queue-worker", {
      airline,
      crawlRunId,
      maxIterations,
      adults,
      requestDelayMs,
      requestJitterMs,
      cooldownMs,
    });

    res.json({
      ok: true,
      runId: handle.id,
      crawlRunId,
      traceId: uuidToTraceId(crawlRunId),
      publicAccessToken: handle.publicAccessToken,
      task: "crawl-queue-worker",
      params: { airline, maxIterations, adults, requestDelayMs, requestJitterMs, cooldownMs },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.get("/api/origins", async (req, res) => {
  try {
    const airline = String(req.query.airline ?? "").toUpperCase() || undefined;
    const { getClickHouse } = await import("../db/clickhouse.js");
    const ch = getClickHouse();
    const params: Record<string, unknown> = {};
    let filter = "";
    if (airline) {
      filter = "WHERE airline_code = {airline:String}";
      params.airline = airline;
    }
    const r = await ch.query({
      query: `
        SELECT origin_iata AS iata, count() AS n
        FROM airline_routes_latest
        ${filter}
        GROUP BY origin_iata
        ORDER BY origin_iata
      `,
      query_params: params,
      format: "JSONEachRow",
    });
    const rows = (await r.json()) as Array<{ iata: string; n: number }>;
    res.json({
      ok: true,
      airline,
      origins: rows.map((row) => ({
        iata: String(row.iata).toUpperCase(),
        destinations: Number(row.n),
      })),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.get("/api/destinations", async (req, res) => {
  try {
    const originRaw = String(req.query.origin ?? "").trim().toUpperCase();
    const airline = String(req.query.airline ?? "").toUpperCase() || undefined;
    if (!/^[A-Z]{3}$/.test(originRaw)) {
      res.status(400).json({ ok: false, error: "origin must be a 3-letter IATA code" });
      return;
    }
    const { getClickHouse } = await import("../db/clickhouse.js");
    const ch = getClickHouse();
    const params: Record<string, unknown> = { origin: originRaw };
    let extra = "";
    if (airline) {
      extra = "AND airline_code = {airline:String}";
      params.airline = airline;
    }
    const r = await ch.query({
      query: `
        SELECT destination_iata AS iata, any(destination_name) AS name
        FROM airline_routes_latest
        WHERE origin_iata = {origin:String}
        ${extra}
        GROUP BY destination_iata
        ORDER BY destination_iata
      `,
      query_params: params,
      format: "JSONEachRow",
    });
    const rows = (await r.json()) as Array<{ iata: string; name: string }>;
    res.json({
      ok: true,
      origin: originRaw,
      airline,
      destinations: rows.map((row) => ({
        iata: String(row.iata).toUpperCase(),
        name: row.name ?? "",
      })),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.get("/api/iatas", async (req, res) => {
  try {
    const airline = (req.query.airline as string | undefined)?.toUpperCase();
    const { getClickHouse } = await import("../db/clickhouse.js");
    const ch = getClickHouse();
    const result = await ch.query({
      query: `
        SELECT origin_iata AS iata FROM airline_routes_latest WHERE origin_iata != ''
        ${airline ? "AND airline_code = {airline:String}" : ""}
        UNION DISTINCT
        SELECT destination_iata AS iata FROM airline_routes_latest WHERE destination_iata != ''
        ${airline ? "AND airline_code = {airline:String}" : ""}
        ORDER BY iata
      `,
      query_params: airline ? { airline } : undefined,
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as Array<{ iata: string }>;
    res.json({ ok: true, iatas: rows.map((r) => r.iata.toUpperCase()) });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.get("/api/queue/stats", async (req, res) => {
  try {
    const airlineRaw = String(req.query.airline ?? "Ryanair");
    if (airlineRaw !== "Ryanair" && airlineRaw !== "EasyJet") {
      res.status(400).json({ ok: false, error: `airline must be "Ryanair" or "EasyJet"` });
      return;
    }
    const { getQueueStats, listProgress } = await import("../db/crawl-progress.js");
    const stats = await getQueueStats({ airline: airlineRaw });
    res.json({ ok: true, airline: airlineRaw, ...stats });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
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
    const validStatuses = new Set(["pending", "processing", "completed", "failed"]);
    if (!validStatuses.has(statusRaw)) {
      res.status(400).json({
        ok: false,
        error: "status must be one of pending|processing|completed|failed",
      });
      return;
    }
    const limit = Math.min(Math.max(1, Number(req.query.limit ?? 200)), 1000);
    const offset = Math.max(0, Math.floor(Number(req.query.offset ?? 0)));
    const originRaw = typeof req.query.origin === "string" ? req.query.origin.trim().toUpperCase() : "";
    const origin = /^[A-Z]{3}$/.test(originRaw) ? originRaw : "";
    const dateFrom = typeof req.query.dateFrom === "string" ? req.query.dateFrom : "";
    const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo : "";

    const { getClickHouse } = await import("../db/clickhouse.js");
    const ch = getClickHouse();

    const params: Record<string, string | number> = {
      airline: airlineRaw,
      limit,
      offset,
    };
    const conditions: string[] = ["airline = {airline:String}", "status = {status:String}"];
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
    const rows = (await r.json()) as Array<Record<string, unknown>>;
    const items = rows.map((r) => ({
      airline: r.airline,
      origin: String(r.origin_iata).toUpperCase(),
      destination: String(r.destination_iata).toUpperCase(),
      dateFrom: String(r.date_from).slice(0, 10),
      dateTo: String(r.date_to).slice(0, 10),
      status: r.status,
      crawlRunId: r.crawl_run_id,
      traceId: r.crawl_run_id ? uuidToTraceId(String(r.crawl_run_id)) : "",
      rowsInserted: Number(r.rows_inserted ?? 0),
      errorMessage: r.error_message,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      insertedAt: r.inserted_at,
    }));
    res.json({ ok: true, airline: airlineRaw, status: statusRaw, count: items.length, items });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.get("/api/queue/items-by-run", async (req, res) => {
  try {
    const crawlRunId = String(req.query.runId ?? "").trim();
    if (!crawlRunId) {
      res.status(400).json({ ok: false, error: "runId is required" });
      return;
    }
    const { getClickHouse } = await import("../db/clickhouse.js");
    const ch = getClickHouse();
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
      format: "JSONEachRow",
    });
    const rows = (await r.json()) as Array<Record<string, unknown>>;
    res.json({
      ok: true,
      runId: crawlRunId,
      traceId: uuidToTraceId(crawlRunId),
      count: rows.length,
      items: rows.map((r) => ({
        airline: r.airline,
        origin: String(r.origin_iata).toUpperCase(),
        destination: String(r.destination_iata).toUpperCase(),
        dateFrom: String(r.date_from).slice(0, 10),
        dateTo: String(r.date_to).slice(0, 10),
        status: r.status,
        crawlRunId: r.crawl_run_id,
        rowsInserted: Number(r.rows_inserted ?? 0),
        errorMessage: r.error_message,
        startedAt: r.started_at,
        completedAt: r.completed_at,
      })),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.get("/api/runs/recent", async (req, res) => {
  try {
    const limit = Math.min(50, Number(req.query.limit ?? 20));
    const taskIdentifier = typeof req.query.task === "string" ? req.query.task : undefined;
    const list = await runs.list({ limit });
    type RunLite = {
      id: string;
      taskIdentifier?: string;
      status?: string;
      createdAt?: Date | string;
      updatedAt?: Date | string;
      startedAt?: Date | string;
      finishedAt?: Date | string;
      isCompleted?: boolean;
      output?: unknown;
      payload?: unknown;
      metadata?: unknown;
    };
    const rawData = (list.data ?? []) as unknown as RunLite[];
    const data = taskIdentifier
      ? rawData.filter((r) => r.taskIdentifier === taskIdentifier)
      : rawData;
    const toIso = (v: Date | string | undefined): string | null =>
      v == null ? null : v instanceof Date ? v.toISOString() : String(v);
    const summaries = data.slice(0, limit).map((r) => {
      const output = (r.output ?? {}) as Record<string, unknown>;
      const payload = (r.payload ?? {}) as Record<string, unknown>;
      const meta = (r.metadata ?? {}) as Record<string, unknown>;
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
        currentDestination: meta?.currentDestination ? String(meta.currentDestination) : null,
      };
    });
    res.json({ ok: true, count: summaries.length, runs: summaries });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.get("/api/runs", async (req, res) => {
  try {
    const limit = Math.min(50, Number(req.query.limit ?? 10));
    const list = await runs.list({ limit });
    res.json({ ok: true, runs: list.data });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.get("/api/runs/active", async (_req, res) => {
  try {
    const list = await runs.list({ limit: 50 });
    const all = (list.data ?? []) as Array<Record<string, unknown>>;
    const toMs = (v: unknown): number => {
      if (!v) return Number.MAX_SAFE_INTEGER;
      const d = v instanceof Date ? v : new Date(String(v));
      const t = d.getTime();
      return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
    };
    const executing = all
      .filter((r) => String(r.status ?? "").toUpperCase() === "EXECUTING")
      .sort((a, b) => toMs(a.startedAt) - toMs(b.startedAt));
    const queued = all
      .filter((r) => String(r.status ?? "").toUpperCase() === "QUEUED")
      .sort((a, b) => toMs(a.createdAt) - toMs(b.createdAt));
    res.json({
      ok: true,
      executing,
      queued,
      totals: { executing: executing.length, queued: queued.length },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.get("/api/runs/:runId", async (req, res) => {
  try {
    const run = await runs.retrieve(req.params.runId);
    res.json({ ok: true, run });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.post("/api/runs/:runId/cancel", async (req, res) => {
  try {
    const result = await runs.cancel(req.params.runId);
    res.json({ ok: true, runId: req.params.runId, status: (result as unknown as { status?: string } | null)?.status ?? null });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
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
    const { getClickHouseForOtel } = await import("../db/clickhouse.js");
    const ch = getClickHouseForOtel();

    const minutes = Math.min(Math.max(1, Number(req.query.windowMinutes ?? 1440)), 60 * 24 * 30);
    const sinceIso = new Date(Date.now() - minutes * 60_000).toISOString().slice(0, 19).replace("T", " ");

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
        format: "JSONEachRow",
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
        format: "JSONEachRow",
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
        format: "JSONEachRow",
      }),
    ]);

    const logs = (await logsRes.json()) as Array<Record<string, unknown>>;
    const spans = (await spansRes.json()) as Array<Record<string, unknown>>;
    const metrics = (await metricsRes.json()) as Array<Record<string, unknown>>;

    res.json({
      ok: true,
      runId: runIdRaw || null,
      traceId,
      hyperdx: hyperdxForTrace(traceId, minutes, runIdRaw),
      counts: { logs: logs.length, spans: spans.length, metrics: metrics.length },
      logs,
      spans,
      metrics,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.get("/api/otel/recent-traces", async (_req, res) => {
  try {
    const { getClickHouseForOtel } = await import("../db/clickhouse.js");
    const ch = getClickHouseForOtel();
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
      format: "JSONEachRow",
    });
    const rows = (await r.json()) as Array<Record<string, unknown>>;
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
        hyperdx: hyperdxForTrace(String(row.TraceId), 60 * 24 * 7),
      })),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

function hyperdxForTrace(traceId: string, windowMinutes = 60 * 24 * 7, runIdHint?: string) {
  const from = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const to = new Date(Date.now() + 60_000).toISOString();
  const search = `${HYPERDX_URL}/search?q=${encodeURIComponent(traceId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const session = `${HYPERDX_URL}/search/${encodeURIComponent(traceId)}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  return { search, session, traceId, runIdHint: runIdHint ?? null, windowMinutes };
}

function spawnScript(scriptRelPath: string, args: string[]): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}> {
  const repoRoot = join(import.meta.dirname, "..", "..");
  const scriptPath = join(repoRoot, "scripts", scriptRelPath);
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["tsx", scriptPath, ...args], {
      cwd: repoRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const started = Date.now();
    child.stdout.on("data", (b: Buffer) => {
      stdout += b.toString("utf8");
    });
    child.stderr.on("data", (b: Buffer) => {
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
    const mode: "rows" | "mark-failed" =
      req.body?.mode === "mark-failed" ? "mark-failed" : "rows";
    const dryRun: boolean = Boolean(req.body?.dryRun);
    const errorMessage: string = String(
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
      stderr: result.stderr,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.post("/api/scripts/manage-crawl-progress", async (req, res) => {
  try {
    const mode: "list" | "failed" | "requeue" = ((): "list" | "failed" | "requeue" => {
      if (req.body?.mode === "failed") return "failed";
      if (req.body?.mode === "requeue") return "requeue";
      return "list";
    })();
    const airline: string = String(req.body?.airline ?? "Ryanair");
    const origin: string = String(req.body?.origin ?? "").trim().toUpperCase();
    const dateFrom: string = String(req.body?.dateFrom ?? "");
    const dateTo: string = String(req.body?.dateTo ?? "");
    const destinations = parseIataList(req.body?.destinations ?? []);
    const includeCompleted: boolean = Boolean(req.body?.includeCompleted);

    if (airline !== "Ryanair" && airline !== "EasyJet") {
      res.status(400).json({ ok: false, error: `airline must be "Ryanair" or "EasyJet" (got "${airline}")` });
      return;
    }
    if (!origin || !dateFrom || !dateTo) {
      res
        .status(400)
        .json({ ok: false, error: "origin, dateFrom and dateTo are required" });
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
      dateTo,
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
      stderr: result.stderr,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
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
      stderr: result.stderr,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
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
      stderr: result.stderr,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Frontend listening on http://localhost:${PORT}`);
  });
}

export { app };

/* ====================================================== */
/* Map UI endpoints                                       */
/* ====================================================== */

app.get("/api/map/airports", async (req, res) => {
  try {
    const airline = typeof req.query.airline === "string" && req.query.airline
      ? req.query.airline
      : "Ryanair";
    const { listAirportsForAirline } = await import("../db/airports.js");
    const rows = await listAirportsForAirline(airline);
    res.json({
      ok: true,
      airline,
      count: rows.length,
      airports: rows,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.get("/api/map/airports/search", async (req, res) => {
  try {
    const q = String(req.query.q ?? "");
    const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 25)));
    const { searchAirports } = await import("../db/airports.js");
    const airports = await searchAirports(q, limit);
    res.json({ ok: true, query: q, count: airports.length, airports });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.get("/api/map/airports/:iata/fares", async (req, res) => {
  try {
    const iata = String(req.params.iata ?? "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(iata)) {
      res.status(400).json({ ok: false, error: "iata must be a 3-letter code" });
      return;
    }
    const airline = typeof req.query.airline === "string" && req.query.airline ? req.query.airline : undefined;
    const dateFrom = typeof req.query.dateFrom === "string" ? req.query.dateFrom : "";
    const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo : "";
    const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 200)));
    const { getAirport, listFaresForAirport } = await import("../db/airports.js");
    const airport = await getAirport(iata);
    const fares = await listFaresForAirport({
      iata,
      airline,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      limit,
    });
    res.json({
      ok: true,
      iata,
      airport,
      count: fares.length,
      fares,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.get("/api/map/airports/:iata/routes", async (req, res) => {
  try {
    const iata = String(req.params.iata ?? "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(iata)) {
      res.status(400).json({ ok: false, error: "iata must be a 3-letter code" });
      return;
    }
    const { getRoutesForAirport } = await import("../db/airports.js");
    const routes = await getRoutesForAirport(iata);
    res.json({ ok: true, iata, count: routes.length, routes });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.get("/api/map/airports/:iata/inbound", async (req, res) => {
  try {
    const iata = String(req.params.iata ?? "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(iata)) {
      res.status(400).json({ ok: false, error: "iata must be a 3-letter code" });
      return;
    }
    const { getInboundOriginsForAirport } = await import("../db/airports.js");
    const origins = await getInboundOriginsForAirport(iata);
    res.json({ ok: true, iata, count: origins.length, origins });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.get("/api/map/fare-finder/cheapest-destinations", async (req, res) => {
  try {
    const origin = String(req.query.origin ?? "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(origin)) { res.status(400).json({ ok: false, error: "origin must be a 3-letter IATA" }); return; }
    const dateFrom = String(req.query.dateFrom ?? "").trim();
    const dateTo = String(req.query.dateTo ?? "").trim();
    if (!dateFrom || !dateTo) { res.status(400).json({ ok: false, error: "dateFrom and dateTo are required" }); return; }
    const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 12)));
    const airline = typeof req.query.airline === "string" ? req.query.airline : undefined;
    const airlineCode = typeof req.query.airlineCode === "string" ? req.query.airlineCode : undefined;
    const maxPrice = typeof req.query.maxPrice === "string" ? Number(req.query.maxPrice) : undefined;
    const { findCheapestDestinations } = await import("../db/fare-finder.js");
    const { results: deals, window } = await findCheapestDestinations({ origin, dateFrom, dateTo, airline, airlineCode, maxPrice, limit });
    res.json({ ok: true, origin, window, count: deals.length, destinations: deals });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.get("/api/map/fare-finder/cheapest-dates", async (req, res) => {
  try {
    const origin = String(req.query.origin ?? "").trim().toUpperCase();
    const destination = String(req.query.destination ?? "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination)) { res.status(400).json({ ok: false, error: "origin and destination must be 3-letter IATAs" }); return; }
    const dateFrom = String(req.query.dateFrom ?? "").trim();
    const dateTo = String(req.query.dateTo ?? "").trim();
    if (!dateFrom || !dateTo) { res.status(400).json({ ok: false, error: "dateFrom and dateTo are required" }); return; }
    const airlineCode = typeof req.query.airlineCode === "string" ? req.query.airlineCode : undefined;
    const limit = Math.min(120, Math.max(1, Number(req.query.limit ?? 60)));
    const { findCheapestDates } = await import("../db/fare-finder.js");
    const { results: cells, window } = await findCheapestDates({ origin, destination, dateFrom, dateTo, airlineCode, limit });
    res.json({ ok: true, origin, destination, window, count: cells.length, cells });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.get("/api/map/fare-finder/best-round-trip", async (req, res) => {
  try {
    const origin = String(req.query.origin ?? "").trim().toUpperCase();
    const destination = String(req.query.destination ?? "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination)) { res.status(400).json({ ok: false, error: "origin and destination must be 3-letter IATAs" }); return; }
    const dateFrom = String(req.query.dateFrom ?? "").trim();
    const dateTo = String(req.query.dateTo ?? "").trim();
    if (!dateFrom || !dateTo) { res.status(400).json({ ok: false, error: "dateFrom and dateTo are required" }); return; }
    const minDays = Math.min(60, Math.max(1, Number(req.query.minDays ?? 3)));
    const maxDays = Math.min(60, Math.max(minDays, Number(req.query.maxDays ?? 14)));
    const airlineCode = typeof req.query.airlineCode === "string" ? req.query.airlineCode : undefined;
    const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 5)));
    const { findBestRoundTrip } = await import("../db/fare-finder.js");
    const { results: bundles, window } = await findBestRoundTrip({ origin, destination, dateFrom, dateTo, minDays, maxDays, airlineCode, limit });
    res.json({ ok: true, origin, destination, window: { ...window, minDays, maxDays }, count: bundles.length, options: bundles });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.get("/api/map/fare-finder/best-one-way", async (req, res) => {
  try {
    const origin = String(req.query.origin ?? "").trim().toUpperCase();
    const destination = String(req.query.destination ?? "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination)) { res.status(400).json({ ok: false, error: "origin and destination must be 3-letter IATAs" }); return; }
    const dateFrom = String(req.query.dateFrom ?? "").trim();
    const dateTo = String(req.query.dateTo ?? "").trim();
    if (!dateFrom || !dateTo) { res.status(400).json({ ok: false, error: "dateFrom and dateTo are required" }); return; }
    const airlineCode = typeof req.query.airlineCode === "string" ? req.query.airlineCode : undefined;
    const limit = Math.min(60, Math.max(1, Number(req.query.limit ?? 10)));
    const { findBestOneWay } = await import("../db/fare-finder.js");
    const { results: fares, window } = await findBestOneWay({ origin, destination, dateFrom, dateTo, airlineCode, limit });
    res.json({ ok: true, origin, destination, window, count: fares.length, fares });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.post("/api/map/fare-finder/cheapest-from-any", async (req, res) => {
  try {
    const originsRaw = Array.isArray(req.body?.origins) ? req.body.origins : null;
    if (!originsRaw || originsRaw.length < 1 || originsRaw.length > 8) { res.status(400).json({ ok: false, error: "origins must be a 1-8 item array of 3-letter IATAs" }); return; }
    const origins = originsRaw.map((s: unknown) => String(s).trim().toUpperCase()).filter((s: string) => /^[A-Z]{3}$/.test(s));
    if (origins.length === 0) { res.status(400).json({ ok: false, error: "origins contains no valid IATAs" }); return; }
    const dateFrom = String(req.body?.dateFrom ?? "").trim();
    const dateTo = String(req.body?.dateTo ?? "").trim();
    if (!dateFrom || !dateTo) { res.status(400).json({ ok: false, error: "dateFrom and dateTo are required" }); return; }
    const destination = typeof req.body?.destination === "string" && req.body.destination ? String(req.body.destination).trim().toUpperCase() : undefined;
    const limit = Math.min(50, Math.max(1, Number(req.body?.limit ?? 10)));
    const { findCheapestFromAnyOrigin } = await import("../db/fare-finder.js");
    const { results: deals, window } = await findCheapestFromAnyOrigin({ origins, destination, dateFrom, dateTo, limit });
    res.json({ ok: true, origins, window, count: deals.length, destinations: deals });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.get("/api/map/fare-finder/weekend-deals", async (req, res) => {
  try {
    const origin = String(req.query.origin ?? "").trim().toUpperCase();
    const destination = String(req.query.destination ?? "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination)) { res.status(400).json({ ok: false, error: "origin and destination must be 3-letter IATAs" }); return; }
    const dateFrom = String(req.query.dateFrom ?? "").trim();
    const dateTo = String(req.query.dateTo ?? "").trim();
    if (!dateFrom || !dateTo) { res.status(400).json({ ok: false, error: "dateFrom and dateTo are required" }); return; }
    const nights = Math.min(21, Math.max(1, Number(req.query.nights ?? 4)));
    const airlineCode = typeof req.query.airlineCode === "string" ? req.query.airlineCode : undefined;
    const limit = Math.min(20, Math.max(1, Number(req.query.limit ?? 5)));
    const { findWeekendDeals } = await import("../db/fare-finder.js");
    const { results: bundles, window } = await findWeekendDeals({ origin, destination, dateFrom, dateTo, nightCount: nights, airlineCode, limit });
    res.json({ ok: true, origin, destination, window: { ...window, nights }, count: bundles.length, options: bundles });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.get("/api/map/fare-finder/freshness", async (_req, res) => {
  try {
    const { getDatasetFreshness, buildToolHints } = await import("../db/fare-finder.js");
    const f = await getDatasetFreshness();
    res.json({ ok: true, ...f, hints: buildToolHints(f) });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.post("/api/map/itinerary/generate", async (req, res) => {
  try {
    const prompt = String(req.body?.prompt ?? "").trim();
    const homeIata = String(req.body?.homeIata ?? "MLA").trim().toUpperCase();
    const dateFrom = String(req.body?.dateFrom ?? nextMonthStartIso());
    const dateTo = String(req.body?.dateTo ?? monthAfterNextStartIso());
    const daysPerCountry = Math.max(1, Math.floor(Number(req.body?.daysPerCountry ?? 3)));
    const flexDays = Math.max(0, Math.floor(Number(req.body?.flexDays ?? 1)));
    const preferredAirlines = Array.isArray(req.body?.preferredAirlines)
      ? (req.body.preferredAirlines as unknown[]).map((s) => String(s)).filter(Boolean)
      : [];
    const maxItineraries = Math.min(8, Math.max(1, Math.floor(Number(req.body?.maxItineraries ?? 4))));
    const destinations = Array.isArray(req.body?.destinations)
      ? (req.body.destinations as unknown[])
          .map((s) => String(s).toUpperCase())
          .filter((s) => /^[A-Z]{3}$/.test(s))
      : [];
    const plannerRaw = String(req.body?.planner ?? "sql").toLowerCase();
    const planner: "sql" | "legacy" = plannerRaw === "legacy" ? "legacy" : "sql";

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

    const { getAirport } = await import("../db/airports.js");

    let itineraries: Array<{
      id: string;
      title: string;
      totalPrice: number;
      currency: string;
      totalDurationMinutes: number | null;
      legs: Array<Record<string, unknown>>;
      summary: string;
      recommendationScore: number;
    }>;

    let sqlPlannerWindow: { dateFrom: string; dateTo: string; requestedFrom: string; requestedTo: string; truncated: boolean; maxDate: string } | undefined;
    if (planner === "sql" && destinations.length >= 1) {
      // New SQL-only planner: single ClickHouse pass over all permutations with
      // arrival+buffer date constraints. Respects actual prices + timing.
      const { planBestItinerary } = await import("../db/itinerary-planner.js");
      const sqlResult = await planBestItinerary({
        home: homeIata,
        stops: destinations,
        dateFrom,
        dateTo,
        bufferDays: daysPerCountry,
        flexDays,
        preferredAirlines,
        topK: maxItineraries,
      });
      sqlPlannerWindow = sqlResult.window;
      const sqlResults = sqlResult.itineraries;
      itineraries = await Promise.all(sqlResults.map(async (it) => ({
        id: it.permutation.join("-") + "-" + it.legs[0]?.date + "-" + it.legs.at(-1)?.date,
        title: `${homeIata} → ${it.permutation.join(" → ")} → ${homeIata}`,
        totalPrice: it.totalPrice,
        currency: it.currency,
        totalDurationMinutes: it.totalDurationMinutes,
        legs: await Promise.all(it.legs.map(async (leg) => ({
          origin: leg.origin,
          destination: leg.destination,
          date: leg.date,
          departureDatetime: leg.departureDatetime,
          arrivalDatetime: leg.arrivalDatetime,
          price: leg.price,
          currency: leg.currency,
          airline: leg.airline,
          durationMinutes: leg.durationMinutes,
          originAirport: await getAirport(leg.origin),
          destinationAirport: await getAirport(leg.destination),
        }))),
        summary: `Cheapest valid itinerary across ${destinations.length} stops. ` +
          `Total flight time: ${it.totalDurationMinutes ?? "—"} min.`,
        recommendationScore: Math.max(0, Math.round(100 - it.totalPrice)),
      })));
    } else {
      // Legacy prompt-driven planner.
      const { generateItineraries } = await import("../db/itinerary.js");
      const legacy = await generateItineraries({
        prompt: prompt || undefined,
        homeIata,
        dateFrom,
        dateTo,
        daysPerCountry,
        preferredAirlines,
        maxItineraries,
        destinations,
      });
      itineraries = await Promise.all(legacy.map(async (it) => ({
        ...it,
        legs: await Promise.all(it.legs.map(async (leg) => ({
          ...leg,
          originAirport: await getAirport(leg.origin),
          destinationAirport: await getAirport(leg.destination),
        }))) as Array<Record<string, unknown>>,
      })));
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
        flexDays,
        preferredAirlines,
        destinations,
        maxItineraries,
      },
      window: sqlPlannerWindow,
      count: itineraries.length,
      itineraries,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.get("/api/map/itinerary/favorites", async (_req, res) => {
  try {
    const { listFavorites } = await import("../db/itinerary.js");
    res.json({ ok: true, count: listFavorites().length, favorites: listFavorites() });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.post("/api/map/itinerary/favorites", async (req, res) => {
  try {
    const itinerary = req.body?.itinerary;
    if (!itinerary || !itinerary.id || !Array.isArray(itinerary.legs)) {
      res.status(400).json({ ok: false, error: "itinerary { id, legs, ... } is required" });
      return;
    }
    const { saveFavorite } = await import("../db/itinerary.js");
    const fav = saveFavorite(itinerary);
    res.json({ ok: true, favorite: fav });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.delete("/api/map/itinerary/favorites/:id", async (req, res) => {
  try {
    const { removeFavorite } = await import("../db/itinerary.js");
    const ok = removeFavorite(req.params.id);
    res.json({ ok, removed: ok });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.get("/api/tools", async (_req, res) => {
  try {
    const { listTools } = await import("../trigger/tools/registry.js");
    const tools = listTools().map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
    res.json({ ok: true, count: tools.length, tools });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
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
    const { resolveCredentials } = await import("../llm/key-vault.js");
    const creds = resolveCredentials();
    res.json({
      ok: true,
      configured: Boolean(creds.apiKey),
      source: creds.source === "none" ? "none" : "hosted",
      provider: creds.apiKey ? creds.provider : null,
      model: creds.apiKey ? creds.model ?? null : null,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

function sseHeaders(res: express.Response) {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
}

function sseSend(res: express.Response, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

const TRIGGER_TERMINAL = new Set([
  "COMPLETED",
  "FAILED",
  "CANCELED",
  "CANCELLED",
  "CRASHED",
  "SYSTEM_FAILURE",
  "EXPIRED",
  "TIMED_OUT",
]);

async function pollRunUntilTerminal(runId: string, res: express.Response, abort: AbortSignal) {
  let lastStatus: string | null = null;
  for (let i = 0; i < 600; i++) {
    if (abort.aborted) return;
    try {
      const run = await runs.retrieve(runId);
      const status = String(run.status ?? "UNKNOWN");
      const payload: Record<string, unknown> = {
        runId,
        status,
        taskIdentifier: run.taskIdentifier ?? null,
        startedAt: run.startedAt ?? null,
        finishedAt: run.finishedAt ?? null,
        costInCents: run.costInCents ?? null,
        durationMs: run.durationMs ?? null,
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
      sseSend(res, "run_status", { runId, status: "ERROR", error: (err as Error).message });
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  sseSend(res, "run_final", { runId, status: "TIMEOUT", error: "frontend-stopped-watching" });
}

app.post("/api/llm/chat", async (req, res) => {
  try {
    const sessionId = req.body?.sessionId ? String(req.body.sessionId) : null;
    const incomingParams = req.body?.parameters as SessionParameters | null;
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : null;
    if (!messages || messages.length === 0) {
      res.status(400).json({ ok: false, error: "messages[] is required" });
      return;
    }
    sseHeaders(res);
    const ac = new AbortController();
    req.on("close", () => ac.abort());

    let session: ChatSession | null = null;
    if (sessionId) {
      session = chatSessions.get(sessionId) ?? null;
    }
    if (!session) {
      const newId = sessionId || crypto.randomUUID();
      session = {
        id: newId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
        parameters: {},
      };
      chatSessions.set(newId, session);
    }
    if (incomingParams) {
      session.parameters = { ...session.parameters, ...incomingParams };
    }
    for (const msg of messages) {
      if (msg.role === "user") {
        session!.messages.push(msg as ChatMessage);
      }
    }
    session.updatedAt = Date.now();

    const runPollers: Promise<void>[] = [];
    const { resolveCredentials } = await import("../llm/key-vault.js");
    const { runLlmAgent } = await import("../llm/client.js");
    const creds = resolveCredentials();
    const sessionConfigParams = (session?.parameters ?? incomingParams ?? undefined) as
      | SessionParameters
      | undefined;
    const sessionMessages: ChatMessage[] = session?.messages
      ? [...(session.messages as ChatMessage[])]
      : (messages as ChatMessage[]);
    if (sessionConfigParams) {
      const lines: string[] = [];
      if (sessionConfigParams.origin) lines.push(`Origin airport: ${String(sessionConfigParams.origin).toUpperCase()}`);
      if (sessionConfigParams.destination) lines.push(`Destination airport: ${String(sessionConfigParams.destination).toUpperCase()}`);
      if (sessionConfigParams.dateFrom || sessionConfigParams.dateTo) {
        lines.push(`Date range: ${String(sessionConfigParams.dateFrom ?? "open")} to ${String(sessionConfigParams.dateTo ?? "open")}`);
      }
      if (typeof sessionConfigParams.passengers === "number") lines.push(`Passengers: ${sessionConfigParams.passengers}`);
      if (typeof sessionConfigParams.maxPrice === "number") lines.push(`Max total price: ${sessionConfigParams.maxPrice} EUR`);
      if (lines.length > 0) {
        sessionMessages.unshift({
          role: "system",
          content: `[CURRENT SESSION CONFIG] These are the user's saved sidebar settings for this chat session. Use them as defaults; only override when the user explicitly states different values in their message.\n${lines.join("\n")}`,
        });
      }
    }
    const result = await runLlmAgent(
      {
        messages: sessionMessages,
        model: req.body?.model,
        maxIterations: req.body?.maxIterations,
        homeIata: typeof req.body?.homeIata === "string" ? req.body.homeIata.toUpperCase() : undefined,
        homeLocation: {
          ip: req.ip ?? req.socket.remoteAddress ?? undefined,
          country: req.body?.homeLocation?.country,
          lat: req.body?.homeLocation?.lat,
          lon: req.body?.homeLocation?.lon,
        },
      },
      { provider: creds.provider, apiKey: creds.apiKey, model: creds.model },
      (event) => {
        if (event.type === "status") { sseSend(res, "status", event); return; }
        if (event.type === "tool_progress") { sseSend(res, "tool_progress", event); return; }
        if (event.type === "answer") { sseSend(res, "answer", event); return; }
        if (event.type === "error") { sseSend(res, "error", { error: event.error }); return; }
        if (event.type === "done") { sseSend(res, "done", event); return; }
        if (event.type === "run_triggered") {
          sseSend(res, "run_triggered", event);
          runPollers.push(pollRunUntilTerminal(event.runId, res, ac.signal));
        }
      },
    );

    await Promise.allSettled(runPollers);

    if (session && result.messages) {
      const nonSystemMessages = result.messages.filter((m: ChatMessage) => m.role !== "system");
      session.messages = nonSystemMessages;
      session.updatedAt = Date.now();
    }

    sseSend(res, "final", {
      ok: result.ok,
      answer: result.answer,
      iterations: result.iterations,
      error: result.error ?? null,
      provider: result.provider,
      model: result.model,
      sessionId: session?.id ?? null,
      sessionMessages: session?.messages ?? null,
      sessionParameters: session?.parameters ?? null,
    });
    res.end();
  } catch (err) {
    try { sseSend(res, "error", { error: (err as Error).message }); res.end(); } catch { /* aborted */ }
  }
});

app.post("/api/llm/chat-agent", async (req, res) => {
  try {
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    const chatId = typeof req.body?.chatId === "string" && req.body.chatId.trim()
      ? req.body.chatId.trim()
      : crypto.randomUUID();
    if (!text) {
      res.status(400).json({ ok: false, error: "text is required" });
      return;
    }

    const incomingClientData = (req.body?.clientData && typeof req.body.clientData === "object")
      ? req.body.clientData
      : {};
    const clientData = {
      model: typeof incomingClientData.model === "string" ? incomingClientData.model : undefined,
      maxIterations: typeof incomingClientData.maxIterations === "number"
        ? Math.min(20, Math.max(1, Math.floor(incomingClientData.maxIterations)))
        : 12,
      homeIata: typeof incomingClientData.homeIata === "string"
        ? incomingClientData.homeIata.toUpperCase()
        : undefined,
      parameters: incomingClientData.parameters ?? {},
      homeLocation: {
        ip: req.ip ?? req.socket.remoteAddress ?? undefined,
        country: incomingClientData.homeLocation?.country,
        lat: incomingClientData.homeLocation?.lat,
        lon: incomingClientData.homeLocation?.lon,
      },
    };

    sseHeaders(res);
    const ac = new AbortController();
    req.on("close", () => ac.abort());
    res.on("close", () => ac.abort());

    const chat = new AgentChat({
      agent: "wayfare-chat",
      id: chatId,
      clientData,
      streamTimeoutSeconds: 600,
    });

    log.info(">>> chat-agent start", {
      chatId,
      textPreview: text.slice(0, 80),
      homeIata: clientData.homeIata,
    });

    sseSend(res, "status", { status: "thinking", provider: "wayfare-chat", model: clientData.model ?? "default" });

    let stream;
    try {
      stream = await chat.sendMessage(text, { abortSignal: ac.signal });
    } catch (err) {
      log.error("chat-agent: sendMessage failed", { chatId, error: (err as Error).message });
      sseSend(res, "error", { error: (err as Error).message });
      sseSend(res, "final", { ok: false, chatId, error: (err as Error).message });
      res.end();
      return;
    }

    sseSend(res, "status", { status: "answering", provider: "wayfare-chat", model: clientData.model ?? "default" });

    let answer: unknown = null;
    let replyText = "";
    let iter = 0;

    try {
      for await (const chunk of stream) {
        if (ac.signal.aborted) break;
        iter += 1;
        const t = (chunk as { type?: string }).type;
        if (t === "data-wayfare-tool") {
          const data = (chunk as { data?: { tool?: string; label?: string } }).data ?? {};
          sseSend(res, "tool_progress", { tool: data.tool, label: data.label ?? `Working (${data.tool ?? "?"})…` });
          continue;
        }
        if (t === "data-wayfare-run") {
          const data = (chunk as { data?: { tool?: string; runId?: string; task?: string | null; crawlRunId?: string | null } }).data ?? {};
          sseSend(res, "run_triggered", {
            toolName: data.tool ?? "background",
            runId: data.runId ?? "",
            task: data.task ?? null,
            crawlRunId: data.crawlRunId ?? null,
            publicAccessToken: null,
          });
          continue;
        }
        if (t === "data-wayfare-error") {
          const data = (chunk as { data?: { error?: string } }).data ?? {};
          sseSend(res, "error", { error: data.error ?? "unknown error" });
          continue;
        }
        if (t === "data-wayfare-answer") {
          const data = (chunk as { data?: unknown }).data;
          if (data) answer = data;
          sseSend(res, "answer", { answer: data });
          continue;
        }
        if (t === "data-wayfare-tool-summary") {
          continue;
        }
        if (t === "text-delta") {
          const delta = (chunk as { delta?: string }).delta;
          if (typeof delta === "string" && delta.length) replyText += delta;
          continue;
        }
      }
    } catch (err) {
      const msg = (err as Error).message;
      if (!ac.signal.aborted) {
        log.error("chat-agent: stream error", { chatId, error: msg });
        sseSend(res, "error", { error: msg });
      }
    }

    sseSend(res, "done", { iterations: iter, toolCalls: 0 });
    sseSend(res, "final", {
      ok: answer != null,
      chatId,
      answer,
      replyText,
      sessionId: chatId,
    });
    res.end();
    log.info("<<< chat-agent done", { chatId, ok: answer != null, replyBytes: replyText.length });
  } catch (err) {
    try {
      sseSend(res, "error", { error: (err as Error).message });
      res.end();
    } catch {
      /* aborted */
    }
  }
});

app.get("/api/runs/:runId/stream", async (req, res) => {
  try {
    const runId = String(req.params.runId ?? "").trim();
    if (!runId) { res.status(400).json({ ok: false, error: "runId is required" }); return; }
    sseHeaders(res);
    const ac = new AbortController();
    req.on("close", () => ac.abort());
    res.on("close", () => ac.abort());
    await pollRunUntilTerminal(runId, res, ac.signal);
    res.end();
  } catch (err) {
    try { sseSend(res, "error", { error: (err as Error).message }); res.end(); } catch { /* aborted */ }
  }
});

app.post("/api/tools/:id", async (req, res) => {
  try {
    const { getTool } = await import("../trigger/tools/registry.js");
    const tool = getTool(req.params.id);
    if (!tool) {
      res.status(404).json({ ok: false, error: `unknown tool: ${req.params.id}` });
      return;
    }
    const parsed = tool.schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: "invalid parameters", issues: parsed.error.issues });
      return;
    }
    const result = await tool.handler(parsed.data as never);
    res.json({ ok: true, tool: tool.id, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.post("/api/map/round-trip", async (req, res) => {
  try {
    const origin = String(req.body?.origin ?? "").trim().toUpperCase();
    const destination = String(req.body?.destination ?? "").trim().toUpperCase();
    const dateFrom = String(req.body?.dateFrom ?? "");
    const dateTo = String(req.body?.dateTo ?? "");
    const minDays = req.body?.minDays != null ? Math.max(1, Math.floor(Number(req.body.minDays))) : undefined;
    const maxDays = req.body?.maxDays != null ? Math.max(1, Math.floor(Number(req.body.maxDays))) : undefined;
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

    const { findCheapestRoundTrip, getAirport } = await import("../db/airports.js");
    const { trips, window } = await findCheapestRoundTrip({ origin, destination, dateFrom, dateTo, minDays, maxDays });
    const options = await Promise.all(trips.slice(0, limit).map(async (t) => ({
      ...t,
      originAirport: await getAirport(t.origin),
      destinationAirport: await getAirport(t.destination),
    })));
    res.json({
      ok: true,
      origin,
      destination,
      count: options.length,
      options,
      window,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.post("/api/map/multi-city/generate", async (req, res) => {
  try {
    const stopsRaw = Array.isArray(req.body?.stops) ? req.body.stops : null;
    const homeIata = String(req.body?.homeIata ?? "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(homeIata)) {
      res.status(400).json({ ok: false, error: "homeIata is required (3-letter IATA)" });
      return;
    }
    if (!stopsRaw || stopsRaw.length < 1) {
      res.status(400).json({ ok: false, error: "stops[] with at least 1 entry is required" });
      return;
    }
    const dateFrom = String(req.body?.dateFrom ?? "");
    const dateTo = String(req.body?.dateTo ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
      res.status(400).json({ ok: false, error: "dateFrom and dateTo must be YYYY-MM-DD" });
      return;
    }
    const stops = stopsRaw.map((s: Record<string, unknown>, idx: number) => {
      const iata = String(s.iata ?? "").trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(iata)) throw new Error(`stop #${idx + 1}: iata must be a 3-letter code`);
      if (iata === homeIata) throw new Error(`stop #${idx + 1}: cannot equal home airport ${homeIata}`);
      const minStayDays = s.minStayDays != null ? Math.max(1, Math.floor(Number(s.minStayDays))) : undefined;
      const maxStayDays = s.maxStayDays != null ? Math.max(1, Math.floor(Number(s.maxStayDays))) : undefined;
      return { iata, minStayDays, maxStayDays };
    });
    for (let i = 1; i < stops.length; i++) {
      const prev = stops[i - 1] as { iata: string };
      const cur = stops[i] as { iata: string };
      if (cur.iata === prev.iata) {
        res.status(400).json({ ok: false, error: `stop #${i + 1} (${cur.iata}) is a duplicate of the previous stop` });
        return;
      }
    }
    const defaultStayDays = Math.max(1, Math.min(30, Math.floor(Number(req.body?.defaultStayDays ?? 3))));
    const defaultFlexDays = Math.max(0, Math.min(7, Math.floor(Number(req.body?.defaultFlexDays ?? 1))));
    const legFlexDays = Math.max(0, Math.min(7, Math.floor(Number(req.body?.legFlexDays ?? 2))));
    const maxTotalPrice = Math.max(0, Math.floor(Number(req.body?.maxTotalPrice ?? 0)));
    const maxLegPrice = Math.max(0, Math.floor(Number(req.body?.maxLegPrice ?? 0)));
    const limit = Math.max(1, Math.min(100, Math.floor(Number(req.body?.limit ?? 20))));

    const anchorRaw = req.body?.anchor;
    let anchor: { city: string; day: string } | null = null;
    if (anchorRaw && typeof anchorRaw === "object") {
      const city = String(anchorRaw.city ?? "").trim().toUpperCase();
      const day = String(anchorRaw.day ?? "").trim();
      if (!/^[A-Z]{3}$/.test(city) || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
        res.status(400).json({ ok: false, error: "anchor.city and anchor.day must be valid IATA + YYYY-MM-DD" });
        return;
      }
      anchor = { city, day };
    }

    const { findMultiCityBestFare } = await import("../db/multi-city-best-fare.js");
    const result = await findMultiCityBestFare({
      homeIata,
      stops,
      dateFrom,
      dateTo,
      defaultStayDays,
      defaultFlexDays,
      legFlexDays,
      maxTotalPrice,
      maxLegPrice,
      anchor,
      limit,
    });

    const { getAirport } = await import("../db/airports.js");
    const enriched = await Promise.all(
      result.bundles.map(async (b) => ({
        ...b,
        legs: await Promise.all(
          b.legs.map(async (l) => ({
            ...l,
            originAirport: await getAirport(l.from),
            destinationAirport: await getAirport(l.to),
          })),
        ),
      })),
    );

    res.json({
      ok: true,
      bundles: enriched,
      query: result.query,
      window: result.window,
      generatedSql: result.generatedSql,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.post("/api/map/itinerary/refresh-crawl", async (req, res) => {
  try {
    const legs = Array.isArray(req.body?.legs) ? (req.body.legs as Array<Record<string, unknown>>) : [];
    if (legs.length === 0) {
      res.status(400).json({ ok: false, error: "legs array is required" });
      return;
    }
    const crawlRunId = String(req.body?.runId ?? crypto.randomUUID());
    const airline: "Ryanair" | "EasyJet" = req.body?.airline === "EasyJet" ? "EasyJet" : "Ryanair";

    const triggers: Array<{ origin: string; destination: string; dateFrom: string; dateTo: string }> = [];
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

    const { enqueuePendingRoutes } = await import("../db/crawl-progress.js");
    const allOrigins = Array.from(new Set(triggers.map((t) => t.origin)));
    const firstLeg = triggers[0];
    if (!firstLeg) {
      res.status(400).json({ ok: false, error: "no legs to crawl" });
      return;
    }
    const enqueue = await enqueuePendingRoutes({
      airline,
      origins: allOrigins,
      dateFrom: firstLeg.dateFrom,
      dateTo: firstLeg.dateTo,
      crawlRunId,
    });

    const handle = await tasks.trigger<
      typeof import("../trigger/crawl-queue-worker.js").crawlQueueWorker
    >("crawl-queue-worker", {
      airline,
      crawlRunId,
      maxIterations: triggers.length * 2,
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
      legs: triggers,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});


