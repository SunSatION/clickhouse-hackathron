import { getClickHouse } from "./clickhouse.js";
import { logger } from "../lib/logger.js";

const log = logger("src/db/data-window.ts");

export interface DataWindow {
  minDate: string;
  maxDate: string;
  fetchedAt: string;
}

interface CachedWindow {
  window: DataWindow;
  fetchedAtMs: number;
}

let cache: CachedWindow | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Returns the [minDate, maxDate] of `departure_date` available in
 * `flight_listings_latest` across all origins. Cached for 5 minutes.
 *
 * This is the dataset horizon used to clamp LLM-supplied date windows so
 * we don't silently return empty result sets when the user/LLM asks for
 * dates past the latest crawl.
 */
export async function getDataWindow(): Promise<DataWindow> {
  const now = Date.now();
  if (cache && now - cache.fetchedAtMs < CACHE_TTL_MS) return cache.window;

  const ch = getClickHouse();
  const r = await ch.query({
    query: `
      SELECT
        min(departure_date) AS min_d,
        max(departure_date) AS max_d,
        max(latest_observed_at) AS fetched_at
      FROM flight_listings_latest
    `,
    format: "JSONEachRow",
  });
  const rows = (await r.json()) as Array<{ min_d: string; max_d: string; fetched_at: string }>;
  const row = rows[0];
  if (!row || !row.min_d || !row.max_d) {
    throw new Error("data window unavailable: flight_listings_latest returned no rows");
  }
  const window: DataWindow = {
    minDate: toIsoDate(row.min_d),
    maxDate: toIsoDate(row.max_d),
    fetchedAt: String(row.fetched_at ?? new Date().toISOString()),
  };
  cache = { window, fetchedAtMs: now };
  log.info("data window refreshed", { ...window });
  return window;
}

export interface ClampedWindow {
  dateFrom: string;
  dateTo: string;
  truncated: boolean;
  maxDate: string;
}

/**
 * Clamps an LLM-supplied [dateFrom, dateTo] window to the dataset's
 * available range. If the requested window starts after the dataset's
 * maxDate, the result is collapsed to a 1-day window at maxDate so the
 * caller still gets a (likely empty) deterministic response instead of
 * an arbitrary expansion. The `truncated` flag lets the caller surface
 * the actual used window to the user.
 */
export async function clampToDataWindow(
  dateFrom: string,
  dateTo: string,
  opts: { minDays?: number } = {},
): Promise<ClampedWindow> {
  const win = await getDataWindow();
  const minDays = Math.max(1, opts.minDays ?? 1);
  const requestedFrom = dateFrom || win.minDate;
  const requestedTo = dateTo || win.maxDate;
  const clampedTo = requestedTo < win.maxDate ? requestedTo : win.maxDate;
  const clampedFrom = requestedFrom > clampedTo ? clampedTo : requestedFrom;
  const truncated = clampedFrom !== requestedFrom || clampedTo !== requestedTo;
  if (truncated) {
    log.warn("date window clamped to data horizon", {
      requested: { from: requestedFrom, to: requestedTo },
      clamped: { from: clampedFrom, to: clampedTo },
      horizon: win,
    });
  }
  void minDays;
  return {
    dateFrom: clampedFrom,
    dateTo: clampedTo,
    truncated,
    maxDate: win.maxDate,
  };
}

function toIsoDate(raw: string | Date): string {
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  const s = String(raw);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) throw new Error(`invalid date: ${s}`);
  return d.toISOString().slice(0, 10);
}
