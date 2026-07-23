import { getClickHouse } from "./clickhouse.js";
import { clampToDataWindow } from "./data-window.js";
import { logger } from "../lib/logger.js";

const log = logger("src/db/itinerary-planner.ts");

export interface ItineraryLegResult {
  origin: string;
  destination: string;
  departureDatetime: string;
  arrivalDatetime: string;
  date: string;
  price: number;
  currency: string;
  airline: string;
  durationMinutes: number | null;
}

export interface MultiStopItinerary {
  legs: ItineraryLegResult[];
  totalPrice: number;
  currency: string;
  permutation: string[];
  totalDurationMinutes: number | null;
}

export interface PlanBestItineraryResult {
  itineraries: MultiStopItinerary[];
  window: { dateFrom: string; dateTo: string; requestedFrom: string; requestedTo: string; truncated: boolean; maxDate: string };
}

export interface PlanBestItineraryInput {
  home: string;
  stops: string[];
  dateFrom: string;
  dateTo: string;
  /** Base number of days to spend at each stop (minimum enforced when flexDays=0). Default 3. */
  bufferDays?: number;
  /**
   * Flex ± around bufferDays. Stay at each stop is constrained to
   * [bufferDays - flexDays, bufferDays + flexDays] days.
   * A flex of 1 means ±1 day (e.g. 3±1 → 2 to 4 days).
   * Default 1.
   */
  flexDays?: number;
  preferredAirlines?: string[];
  topK?: number;
  /**
   * Cap the number of fare candidates per (perm_id, leg_idx) after
   * de-duplication to the cheapest K per group. Bounds the JOIN
   * explosion for large date ranges. Default 30.
   */
  maxCandidatesPerLeg?: number;
  /**
   * Hard cap on permutations evaluated. If n! exceeds this, we
   * keep only the first N permutations (deterministic order) and warn.
   * Set to 0 to disable the cap (not recommended for n>4).
   */
  maxPermutations?: number;
  /**
   * Skip the query entirely if the combinatorial estimate
   *   (perms × candidatesPerLeg ^ (n+1))
   * exceeds this. Default 50_000_000.
   */
  maxCombinations?: number;
}

const DEFAULT_MAX_CANDIDATES_PER_LEG = 30;
const DEFAULT_MAX_PERMUTATIONS = 50;
const DEFAULT_MAX_COMBINATIONS = 50_000_000;

function permute<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items.slice()];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    const head = items[i];
    if (head === undefined) continue;
    const rest = items.slice(0, i).concat(items.slice(i + 1));
    for (const sub of permute(rest)) out.push([head, ...sub]);
  }
  return out;
}

/**
 * Build ONE ClickHouse SQL statement that finds the cheapest valid
 * multi-stop itinerary across ALL permutations of the stops.
 *
 * Strategy (user's "left joins on each and every fare"):
 *
 *   1. **permutations** — enumerated in JS and inlined as a literal
 *      Array(Array(String)). Each row of `perms_with_id` is one (perm_id, perm[]).
 *
 *   2. **path_legs** — `ARRAY JOIN range(n+1) AS leg_idx` fans each permutation
 *      out into n+1 (origin, destination) legs along the path H → perm → H.
 *
 *   3. **candidates** — INNER JOIN each leg pair to `flight_listings` restricted
 *      to [dateFrom, dateTo] with `GROUP BY (perm_id, leg_idx, date)` to keep
 *      only the cheapest fare per (route, date). This is the "left joins built
 *      on each and every fare" — every fare candidate is fanned out across
 *      (perm_id, leg_idx, date) rows.
 *
 *   4. **chain** — for each (perm_id) walk c0 → c1 → ... → cN via INNER JOIN
 *      on (perm_id, leg_idx) with the date constraint:
 *        c_{i+1}.departure_datetime >= c_i.arrival_datetime + INTERVAL bufferDays DAY
 *      Final return-home leg drops the buffer (`Skip buffer on return home`).
 *
 *   5. ORDER BY total_price LIMIT {topK}.
 *
 * Single ClickHouse round-trip. No JS permutation loop. No mutable state.
 */
function buildItineraryQuery(input: PlanBestItineraryInput): {
  query: string;
  params: Record<string, unknown>;
} {
  const home = input.home.toUpperCase();
  const stops = Array.from(new Set(input.stops.map((s) => s.toUpperCase()))).filter(
    (s) => /^[A-Z]{3}$/.test(s) && s !== home,
  );
  if (stops.length < 1) throw new Error("stops must contain at least 1 airport");
  if (stops.length > 5) throw new Error(`stops supports up to 5 destinations, got ${stops.length}`);
  const n = stops.length;
  const bufferDays = Math.max(0, Math.min(30, input.bufferDays ?? 3));
  const flexDays = Math.max(0, Math.min(15, input.flexDays ?? 1));
  const minStay = bufferDays >= flexDays ? bufferDays - flexDays : 0;
  const maxStay = bufferDays + flexDays;
  const topK = Math.max(1, Math.min(50, input.topK ?? 1));
  const maxCombinations = Math.max(
    1_000_000,
    Math.min(1_000_000_000, input.maxCombinations ?? DEFAULT_MAX_COMBINATIONS),
  );
  const maxPermutations = Math.max(
    0,
    Math.min(1000, input.maxPermutations ?? DEFAULT_MAX_PERMUTATIONS),
  );

  let perms = permute(stops);
  if (maxPermutations > 0 && perms.length > maxPermutations) {
    log.warn("permutation cap reached", {
      n,
      total: perms.length,
      kept: maxPermutations,
    });
    perms = perms.slice(0, maxPermutations);
  }

  // Auto-scale maxCandidatesPerLeg to fit the combinatorial budget.
  // The worst-case JOIN explosion is `perms × candidates^(n+1)`. Solve for
  // candidates that fits maxCombinations, then clamp to the explicit input.
  const legCount = n + 1;
  const autoCandidates = Math.max(
    1,
    Math.floor(Math.pow(maxCombinations / Math.max(1, perms.length), 1 / legCount)),
  );
  const maxCandidatesPerLeg = Math.max(
    1,
    Math.min(500, Math.min(autoCandidates, input.maxCandidatesPerLeg ?? DEFAULT_MAX_CANDIDATES_PER_LEG)),
  );
  log.info("itinerary planner sizing", {
    n,
    perms: perms.length,
    legCount,
    bufferDays,
    flexDays,
    minStay,
    maxStay,
    maxCandidatesPerLeg,
    autoCandidates,
    estCombinations: perms.length * Math.pow(maxCandidatesPerLeg, legCount),
    maxCombinations,
  });

  // Build a literal SQL array-of-arrays: [['STN','BCN','FCO'], ['STN','FCO','BCN'], ...]
  const permsLiteral = `[${perms.map((p) => `[${p.map((s) => `'${s.replace(/'/g, "''")}'`).join(",")}]`).join(",")}]`;

  const params: Record<string, unknown> = {
    home,
    bufferDays,
    minStay,
    maxStay,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    topK,
    maxCandidatesPerLeg,
  };
  const airlineFilter =
    input.preferredAirlines && input.preferredAirlines.length > 0
      ? "AND f.airline_code IN {preferredAirlines:Array(String)}"
      : "";
  if (airlineFilter) params.preferredAirlines = input.preferredAirlines;

  // Per-leg projection and JOIN chain. We materialise one CTE per leg index
  // (l0..lN) so the JOIN chain has explicit named inputs. This is the same
  // shape as the working per-perm SQL but evaluated across ALL perms at once.
  const selectParts: string[] = [];
  const legCtes: string[] = [];
  const joinParts: string[] = [];
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
      `${alias}.duration_minutes AS l${i}_dur`,
    );
    legCtes.push(`${alias} AS (SELECT * FROM pruned WHERE leg_idx = ${i})`);
  }
  const totalExpr = Array.from({ length: n + 1 }, (_, i) => `l${i}.price`).join(" + ");

  for (let i = 1; i <= n; i++) {
    const prev = `l${i - 1}`;
    const next = `l${i}`;
    const isReturnLeg = i === n;
    const constraint = isReturnLeg
      ? `${next}.departure_datetime >= ${prev}.arrival_datetime`
      : `${next}.departure_datetime >= ${prev}.arrival_datetime + INTERVAL {minStay:UInt32} DAY AND ${next}.departure_datetime <= ${prev}.arrival_datetime + INTERVAL {maxStay:UInt32} DAY`;
    joinParts.push(
      `INNER JOIN ${next} ON ${next}.perm_id = ${prev}.perm_id AND ${constraint}`,
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

  const legSource = (idx: number) => `(SELECT * FROM (${prunedSubquery}) WHERE leg_idx = ${idx}) AS l${idx}`;

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

function rowToLeg(row: Record<string, unknown>, idx: number): ItineraryLegResult {
  const n = idx;
  const departureDatetime = String(row[`l${n}_dep`] ?? "");
  const arrivalDatetime = String(row[`l${n}_arr`] ?? "");
  const dateRaw = row[`l${n}_date`];
  const dateStr =
    dateRaw instanceof Date
      ? dateRaw.toISOString().slice(0, 10)
      : String(dateRaw ?? "").slice(0, 10);
  const durRaw = row[`l${n}_dur`];
  let durationMinutes: number | null = durRaw != null ? Number(durRaw) : null;
  if (durationMinutes == null && departureDatetime && arrivalDatetime) {
    const dep = new Date(departureDatetime.replace(" ", "T") + "Z").getTime();
    const arr = new Date(arrivalDatetime.replace(" ", "T") + "Z").getTime();
    if (Number.isFinite(dep) && Number.isFinite(arr) && arr > dep) {
      durationMinutes = Math.round((arr - dep) / 60_000);
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
    durationMinutes,
  };
}

function rowToItinerary(row: Record<string, unknown>, legCount: number): MultiStopItinerary {
  const legs: ItineraryLegResult[] = [];
  let totalDuration = 0;
  let durationKnown = true;
  const permutation: string[] = [];
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
    totalDurationMinutes: durationKnown ? totalDuration : null,
  };
}

/**
 * Find the cheapest valid itinerary across ALL permutations of the stops
 * using ONE ClickHouse SQL statement.
 *
 * For n=3: 6 permutations in one query.
 * For n=4: 24 permutations in one query.
 * For n=5: 120 permutations in one query (may time out on large data).
 */
export async function planBestItinerary(
  input: PlanBestItineraryInput,
): Promise<PlanBestItineraryResult> {
  const requestedFrom = input.dateFrom;
  const requestedTo = input.dateTo;
  const clamped = await clampToDataWindow(requestedFrom, requestedTo, { minDays: 1 });
  const adjusted: PlanBestItineraryInput = {
    ...input,
    dateFrom: clamped.dateFrom,
    dateTo: clamped.dateTo,
  };

  const { query, params } = buildItineraryQuery(adjusted);
  if (process.env.DEBUG_ITINERARY_SQL) {
    console.log("\n--- SQL ---\n" + query + "\n--- /SQL ---");
    console.log("params:", JSON.stringify(params));
  }
  const ch = getClickHouse();

  const startedAt = Date.now();
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 90_000);
  let rows: Array<Record<string, unknown>>;
  try {
    const r = await ch.query({
      query,
      query_params: params,
      format: "JSONEachRow",
      abort_signal: ac.signal,
    });
    rows = (await r.json()) as Array<Record<string, unknown>>;
  } finally {
    clearTimeout(t);
  }
  log.info("itinerary planner SQL", {
    home: input.home,
    stops: input.stops,
    bufferDays: input.bufferDays,
    flexDays: input.flexDays,
    window: { requested: { from: requestedFrom, to: requestedTo }, used: { from: clamped.dateFrom, to: clamped.dateTo }, truncated: clamped.truncated },
    rows: rows.length,
    ms: Date.now() - startedAt,
  });

  const legCount = Array.from(new Set(input.stops.map((s) => s.toUpperCase())))
    .filter((s) => /^[A-Z]{3}$/.test(s) && s !== input.home.toUpperCase()).length + 1;
  const itineraries = rows.map((row) => rowToItinerary(row, legCount));
  return {
    itineraries,
    window: {
      dateFrom: clamped.dateFrom,
      dateTo: clamped.dateTo,
      requestedFrom,
      requestedTo,
      truncated: clamped.truncated,
      maxDate: clamped.maxDate,
    },
  };
}