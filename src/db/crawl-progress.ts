import { getClickHouse } from "./clickhouse";

export type CrawlProgressStatus = "pending" | "processing" | "completed" | "failed";

export type CompletedDestination = {
  destination_iata: string;
  rows_inserted: number;
  crawl_run_id: string;
};

export type ProgressEntry = {
  destination_iata: string;
  status: CrawlProgressStatus;
  crawl_run_id: string;
  rows_inserted: number;
  error_message: string;
  started_at: string;
  completed_at: string;
};

export type QueueItem = {
  airline: string;
  origin_iata: string;
  destination_iata: string;
  date_from: string;
  date_to: string;
  status: CrawlProgressStatus;
  crawl_run_id: string;
  rows_inserted: number;
  error_message: string;
  started_at: string;
  completed_at: string;
  inserted_at: string;
  updated_at: string;
};

export type EnqueueResult = {
  enqueued: number;
  already_pending: number;
  already_tracked?: number;
};

export async function enqueuePendingRoutes(opts: {
  airline: string;
  origins: string[];
  dateFrom: string;
  dateTo: string;
  crawlRunId?: string;
}): Promise<EnqueueResult> {
  const ch = getClickHouse();

  const { getRoutesForAirlineOrigins } = await import("./airline-routes");
  const routesMap = await getRoutesForAirlineOrigins(opts.airline, opts.origins);

  const now = new Date().toISOString();

  const existingKeys = await listExistingProgressKeys({
    airline: opts.airline,
    origins: opts.origins,
    dateFrom: opts.dateFrom,
    dateTo: opts.dateTo,
  });

  const rows: Omit<QueueItem, "rows_inserted" | "error_message" | "started_at" | "completed_at">[] = [];

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
        updated_at: now,
      });
    }
  }

  if (rows.length === 0) {
    return { enqueued: 0, already_pending: alreadyTracked };
  }

  await ch.insert({
    table: "crawl_progress",
    format: "JSONEachRow",
    values: rows as unknown as Record<string, unknown>[],
  });

  return { enqueued: rows.length, already_pending: alreadyTracked };
}

async function listExistingProgressKeys(opts: {
  airline: string;
  origins: string[];
  dateFrom: string;
  dateTo: string;
}): Promise<Set<string>> {
  if (opts.origins.length === 0) return new Set();
  const placeholders = opts.origins.map((_, i) => `{origin${i}:String}`).join(", ");
  const queryParams: Record<string, string | number> = {
    airline: opts.airline,
    dateFrom: opts.dateFrom,
    dateTo: opts.dateTo,
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
    format: "JSONEachRow",
  });
  const rows = (await result.json()) as Array<{ origin_iata: string; destination_iata: string }>;
  return new Set(
    rows.map((r) => `${String(r.origin_iata).toUpperCase()}|${String(r.destination_iata).toUpperCase()}`)
  );
}

export async function claimSpecificPendingItem(opts: {
  airline: string;
  originIata: string;
  destinationIata: string;
  dateFrom: string;
  dateTo: string;
  crawlRunId: string;
  force?: boolean;
}): Promise<QueueItem | null> {
  const ch = getClickHouse();

  const statusFilter = opts.force
    ? "status IN ('pending', 'processing', 'completed', 'failed')"
    : "status = 'pending'";

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
      dateTo: opts.dateTo,
    },
    format: "JSONEachRow",
  });
  const existing = (await existingResult.json()) as Array<{
    airline: string;
    origin_iata: string;
    destination_iata: string;
    date_from: string;
    date_to: string;
  }>;
  if (!existing[0]) return null;

  const now = new Date().toISOString();
  await ch.insert({
    table: "crawl_progress",
    format: "JSONEachRow",
    values: [
      {
        airline: existing[0]!.airline,
        origin_iata: existing[0]!.origin_iata,
        destination_iata: existing[0]!.destination_iata,
        date_from: existing[0]!.date_from,
        date_to: existing[0]!.date_to,
        status: "processing",
        crawl_run_id: opts.crawlRunId,
        rows_inserted: 0,
        error_message: "",
        started_at: now,
        completed_at: now,
        inserted_at: now,
        updated_at: now,
      },
    ],
  });

  return {
    airline: existing[0]!.airline,
    origin_iata: existing[0]!.origin_iata,
    destination_iata: existing[0]!.destination_iata,
    date_from: existing[0]!.date_from,
    date_to: existing[0]!.date_to,
    status: "processing",
    crawl_run_id: opts.crawlRunId,
    rows_inserted: 0,
    error_message: "",
    started_at: now,
    completed_at: now,
    inserted_at: now,
    updated_at: now,
  };
}

export async function getCurrentRowState(opts: {
  airline: string;
  originIata: string;
  destinationIata: string;
  dateFrom: string;
  dateTo: string;
}): Promise<QueueItem[]> {
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
      dateTo: opts.dateTo,
    },
    format: "JSONEachRow",
  });
  const rows = (await result.json()) as QueueItem[];
  return rows.map((r) => ({
    ...r,
    origin_iata: String(r.origin_iata).toUpperCase(),
    destination_iata: String(r.destination_iata).toUpperCase(),
  }));
}

export async function listPendingItems(opts: {
  airline: string;
  limit?: number;
  originIata?: string;
}): Promise<QueueItem[]> {
  const limit = Math.min(Math.max(1, opts.limit ?? 200), 1000);
  const conditions: string[] = [
    "airline = {airline:String}",
    "status = 'pending'",
  ];
  const queryParams: Record<string, string | number> = {
    airline: opts.airline,
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
    format: "JSONEachRow",
  });
  const rows = (await result.json()) as QueueItem[];
  return rows.map((r) => ({
    ...r,
    origin_iata: String(r.origin_iata).toUpperCase(),
    destination_iata: String(r.destination_iata).toUpperCase(),
  }));
}

export async function claimNextPendingItem(opts: {
  airline: string;
  crawlRunId: string;
  staleAfterMs?: number;
}): Promise<QueueItem | null> {
  const ch = getClickHouse();
  const staleAfterMs = opts.staleAfterMs ?? 30 * 60 * 1000;
  const staleCutoff = new Date(Date.now() - staleAfterMs)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");

  // 1. Sweep stale `processing` rows to `failed`. Done via ch.command() +
  //    INSERT...SELECT. If the SELECT returns nothing, this is a no-op (0
  //    rows read/written) which is safe.
  //    Use now()+1s for inserted_at so the failed row wins argMax over the
  //    predecessor `processing` row even when both fit in the same second.
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
      staleCutoff,
    },
  }).catch((e) => {
    // eslint-disable-next-line no-console
    console.warn("Stale sweep INSERT...SELECT failed (non-fatal)", (e as Error).message);
  });

  // 2. SELECT the next pending row to claim.
  // Picker scopes to the requested crawlRunId so resuming a specific run drains
  // only its own pending rows. Empty-string crawl_run_id (orphan/legacy rows)
  // remains claimable by any worker as a fallback.
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
      crawlRunId: opts.crawlRunId,
    },
    format: "JSONEachRow",
  }).catch((e) => {
    // eslint-disable-next-line no-console
    console.warn("Pending SELECT failed", (e as Error).message);
    return null;
  });
  if (!nextResult) return null;
  const nextRows = (await nextResult.json()) as Array<{
    airline: string;
    origin_iata: string;
    destination_iata: string;
    date_from: string;
    date_to: string;
  }>;
  const next = nextRows[0];
  if (!next) return null;

  // 3. INSERT a 'processing' row for it (ch.insert() reliably writes).
  const now = new Date().toISOString();
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
        updated_at: now,
      },
    ],
  });

  // 4. Read it back via the view to return the full QueueItem.
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
      dateTo: next.date_to,
    },
    format: "JSONEachRow",
  });
  const claimedRows = (await claimed.json()) as QueueItem[];
  return claimedRows[0] ?? null;
}

export async function markProgressCompleted(opts: {
  airline: string;
  originIata: string;
  destinationIata: string;
  dateFrom: string;
  dateTo: string;
  crawlRunId: string;
  rowsInserted: number;
}): Promise<void> {
  const now = new Date();
  const nowIso = now.toISOString();
  // Bump inserted_at by 1s so the terminal row is guaranteed newer than
  // its predecessor `processing` row even when both fit inside the same
  // DateTime second (DateTime has second precision, so argMax would
  // otherwise tie-break non-deterministically).
  const terminalInsertedAt = new Date(now.getTime() + 1000).toISOString();
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
        updated_at: terminalInsertedAt,
      },
    ],
  });
}

export async function markProgressFailed(opts: {
  airline: string;
  originIata: string;
  destinationIata: string;
  dateFrom: string;
  dateTo: string;
  crawlRunId: string;
  error: string;
}): Promise<void> {
  const now = new Date();
  const nowIso = now.toISOString();
  // See markProgressCompleted: bump inserted_at by 1s to break the
  // DateTime-second tie with the predecessor `processing` row.
  const terminalInsertedAt = new Date(now.getTime() + 1000).toISOString();
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
        error_message: opts.error.slice(0, 1000),
        started_at: nowIso,
        completed_at: nowIso,
        inserted_at: terminalInsertedAt,
        updated_at: terminalInsertedAt,
      },
    ],
  });
}

export async function getClaimedDestinations(opts: {
  airline: string;
  originIata: string;
  dateFrom: string;
  dateTo: string;
}): Promise<Set<string>> {
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
      dateTo: opts.dateTo,
    },
    format: "JSONEachRow",
  });
  const rows = await result.json();
  return new Set(
    (rows as Array<{ destination_iata: string }>).map((r) =>
      String(r.destination_iata).toUpperCase()
    )
  );
}

export async function getCompletedDestinations(opts: {
  airline: string;
  originIata: string;
  dateFrom: string;
  dateTo: string;
}): Promise<Set<string>> {
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
      dateTo: opts.dateTo,
    },
    format: "JSONEachRow",
  });
  const rows = await result.json();
  return new Set(
    (rows as Array<{ destination_iata: string }>).map((r) =>
      String(r.destination_iata).toUpperCase()
    )
  );
}

export async function listProgress(opts: {
  airline: string;
  originIata: string;
  dateFrom: string;
  dateTo: string;
}): Promise<ProgressEntry[]> {
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
      dateTo: opts.dateTo,
    },
    format: "JSONEachRow",
  });
  const rows = await result.json();
  return (rows as ProgressEntry[]).map((r) => ({
    ...r,
    destination_iata: String(r.destination_iata).toUpperCase(),
  }));
}

export async function listFailedDestinations(opts: {
  airline: string;
  originIata: string;
  dateFrom: string;
  dateTo: string;
}): Promise<
  Array<{
    destination_iata: string;
    error_message: string;
    crawl_run_id: string;
    completed_at: string;
  }>
> {
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
      dateTo: opts.dateTo,
    },
    format: "JSONEachRow",
  });
  const rows = await result.json();
  return (rows as Array<{
    destination_iata: string;
    error_message: string;
    crawl_run_id: string;
    completed_at: string;
  }>).map((r) => ({
    ...r,
    destination_iata: String(r.destination_iata).toUpperCase(),
  }));
}

export async function requeueDestinations(opts: {
  airline: string;
  originIata: string;
  dateFrom: string;
  dateTo: string;
  destinations?: string[];
  includeFailed?: boolean;
  includeCompleted?: boolean;
  crawlRunId?: string;
}): Promise<number> {
  const includeFailed = opts.includeFailed ?? true;
  const includeCompleted = opts.includeCompleted ?? false;
  const statuses: string[] = [];
  if (includeFailed) statuses.push("'failed'");
  if (includeCompleted) statuses.push("'completed'");
  if (statuses.length === 0) return 0;

  const conditions: string[] = [
    "airline = {airline:String}",
    "origin_iata = {origin:String}",
    "date_from = {dateFrom:Date}",
    "date_to = {dateTo:Date}",
    `status IN (${statuses.join(", ")})`,
  ];
  const queryParams: Record<string, string | number> = {
    airline: opts.airline,
    origin: opts.originIata.toUpperCase(),
    dateFrom: opts.dateFrom,
    dateTo: opts.dateTo,
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
    query_params: { ...queryParams, crawlRunId: opts.crawlRunId ?? "" },
  });

  const countResult = await getClickHouse().query({
    query: `
      SELECT count() AS n
      FROM crawl_progress_latest
      WHERE ${conditions.join(" AND ")}
    `,
    query_params: queryParams,
    format: "JSONEachRow",
  });
  const [row] = (await countResult.json()) as Array<{ n: string | number }>;
  return Number(row?.n ?? 0);
}

export async function getQueueStats(opts: {
  airline: string;
}): Promise<{
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}> {
  const result = await getClickHouse().query({
    query: `
      SELECT status, count() AS cnt
      FROM crawl_progress_latest
      WHERE airline = {airline:String}
      GROUP BY status
    `,
    query_params: { airline: opts.airline },
    format: "JSONEachRow",
  });
  const rows = await result.json();
  const stats = { pending: 0, processing: 0, completed: 0, failed: 0 };
  for (const row of rows as Array<{ status: string; cnt: number }>) {
    if (row.status in stats) {
      stats[row.status as keyof typeof stats] = row.cnt;
    }
  }
  return stats;
}

export async function markDestinationCompleted(opts: {
  airline: string;
  originIata: string;
  destinationIata: string;
  dateFrom: string;
  dateTo: string;
  crawlRunId: string;
  rowsInserted: number;
}): Promise<void> {
  await markProgressCompleted(opts);
}

export async function markDestinationFailed(opts: {
  airline: string;
  originIata: string;
  destinationIata: string;
  dateFrom: string;
  dateTo: string;
  crawlRunId: string;
  error: string;
}): Promise<void> {
  await markProgressFailed(opts);
}
