import { getClickHouse } from "./clickhouse.js";
import { clampToDataWindow } from "./data-window.js";
import { logger } from "../lib/logger.js";

const log = logger("src/db/multi-city-best-fare.ts");

/**
 * One city between home-out and home-back. Stay constraints describe the
 * length of the visit (number of days between arriving at this stop and
 * leaving it).
 */
export interface MultiCityStopSpec {
  iata: string;
  /** Min days to spend at this stop (inclusive). Default = derived from defaultStayDays - defaultFlexDays. */
  minStayDays?: number;
  /** Max days to spend at this stop (inclusive). Default = derived from defaultStayDays + defaultFlexDays. */
  maxStayDays?: number;
}

export interface MultiCityAnchorSpec {
  /** IATA of the city you must be in on anchorDay (must equal one of the leg destinations). */
  city: string;
  /** ISO date YYYY-MM-DD — must be inside [dateFrom, dateTo]. */
  day: string;
}

export interface MultiCityBestFareQuery {
  /**
   * Ordered list of intermediate cities (NOT including the round-trip home).
   * The planner always starts and ends at `homeIata` (configured by the caller).
   */
  stops: MultiCityStopSpec[];
  /** Start of the departure search range (YYYY-MM-DD). */
  dateFrom: string;
  /** End of the departure search range and latest return-home date (YYYY-MM-DD). */
  dateTo: string;
  /** Global default stay length in days for stops that don't override. Default 3. */
  defaultStayDays?: number;
  /** Global default ±flex around the stay. Default 1 (so default stay=3±1 = 2..4 days). */
  defaultFlexDays?: number;
  /** Retained for API compatibility; only explicit anchors restrict calendar dates. Default 2. */
  legFlexDays?: number;
  /** Cap on the sum of all leg prices. Default 0 (no cap). */
  maxTotalPrice?: number;
  /** Cap on any single leg's price. Default 0 (no cap). */
  maxLegPrice?: number;
  /** Optional anchor: "be in CITY on DAY". */
  anchor?: MultiCityAnchorSpec | null;
  /** Top-K bundles to return. Default 20. */
  limit?: number;
  /**
   * Trip origin. Defaults to env WAYFARE_HOME / STN. Set explicitly via the
   * frontend state. The trip always returns home — there is no way to omit it.
   */
  homeIata?: string;
}

export interface MultiCityBestFareLeg {
  from: string;
  to: string;
  departureDate: string;
  arrivalDatetime: string | null;
  flightNumber: string;
  price: number;
  currency: string;
}

export interface MultiCityBestFareBundle {
  legs: MultiCityBestFareLeg[];
  totalPrice: number;
  currency: string;
  tripDays: number;
}

export interface MultiCityBestFareResult {
  bundles: MultiCityBestFareBundle[];
  query: {
    stops: MultiCityStopSpec[];
    homeIata: string;
    dateFrom: string;
    dateTo: string;
    defaultStayDays: number;
    defaultFlexDays: number;
    legFlexDays: number;
    maxTotalPrice: number;
    maxLegPrice: number;
    anchor: MultiCityAnchorSpec | null;
    limit: number;
  };
  window: {
    dateFrom: string;
    dateTo: string;
    clampedDateFrom: string;
    clampedDateTo: string;
    truncated: boolean;
    maxDate: string;
  };
  generatedSql: string;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function escapeIata(s: string): string {
  return s.replace(/[^A-Z]/gi, "").toUpperCase();
}

function resolveQuery(query: string, params: Record<string, unknown>): string {
  return query.replace(/\{(\w+):[^}]+\}/g, (_, name: string) => {
    const val = params[name];
    if (val === undefined) return `{${name}:?}`;
    if (typeof val === "string") return `'${val.replace(/'/g, "''")}'`;
    return String(val);
  });
}

interface ResolvedStop {
  iata: string;
  minStay: number;
  maxStay: number;
}

function resolveStops(
  stops: MultiCityStopSpec[],
  defaultStayDays: number,
  defaultFlexDays: number,
): ResolvedStop[] {
  const flex = Math.max(0, defaultFlexDays);
  return stops.map((s) => {
    const iata = escapeIata(s.iata);
    if (!/^[A-Z]{3}$/.test(iata)) throw new Error(`invalid stop IATA: ${s.iata}`);
    const minStay = Math.max(1, Math.floor(s.minStayDays ?? Math.max(1, defaultStayDays - flex)));
    const maxStayRaw = s.maxStayDays ?? defaultStayDays + flex;
    const maxStay = Math.max(minStay, Math.floor(maxStayRaw));
    return { iata, minStay, maxStay };
  });
}

/**
 * Build a parameterized multi-leg query. Per-leg target days are derived
 * cumulatively from the previous stop's stay, so the SQL chain naturally
 * honors per-stop stay durations. Each leg's `minStay`/`maxStay` constraints
 * are baked into the JOIN.
 */
export function buildMultiCityBestFareQuery(
  home: string,
  stops: Array<{ iata: string; minStay: number; maxStay: number }>,
  q: MultiCityBestFareQuery,
  clampedDateFrom: string,
  clampedDateTo: string,
): { query: string; params: Record<string, unknown> } {
  if (stops.length < 1) throw new Error("multi-city trip needs at least 1 stop");
  if (stops.length > 6) throw new Error("multi-city trip supports up to 6 stops");

  const maxTotalPrice = Math.max(0, Math.floor(q.maxTotalPrice ?? 0));
  const maxLegPrice = Math.max(0, Math.floor(q.maxLegPrice ?? 0));
  const limit = Math.max(1, Math.min(100, Math.floor(q.limit ?? 20)));

  type Leg = { from: string; to: string; stayMin?: number; stayMax?: number };
  const legs: Leg[] = [];
  let prevStop: ResolvedStop | null = null;
  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i]!;
    if (i === 0) {
      legs.push({ from: home, to: stop.iata });
    } else {
      legs.push({
        from: prevStop!.iata,
        to: stop.iata,
        stayMin: prevStop!.minStay,
        stayMax: prevStop!.maxStay,
      });
    }
    prevStop = stop;
  }
  legs.push({
    from: prevStop!.iata,
    to: home,
    stayMin: prevStop!.minStay,
    stayMax: prevStop!.maxStay,
  });

  const params: Record<string, unknown> = {
    home,
    dateFrom: clampedDateFrom,
    dateTo: clampedDateTo,
    maxTotalPrice,
    maxLegPrice,
    useMaxTotal: maxTotalPrice > 0 ? 1 : 0,
    useMaxLeg: maxLegPrice > 0 ? 1 : 0,
    limit,
  };

  const legSubqueries: string[] = [];
  for (let i = 0; i < legs.length; i++) {
    const l = legs[i]!;
    const fromKey = `l${i + 1}_from`;
    const toKey = `l${i + 1}_to`;
    params[fromKey] = l.from;
    params[toKey] = l.to;
    legSubqueries.push(`
      (SELECT flight_number, origin_iata, destination_iata, departure_date,
              arrival_datetime, price, currency
         FROM flight_listings_latest
        WHERE origin_iata      = {${fromKey}:String}
          AND destination_iata = {${toKey}:String}
          AND departure_date BETWEEN toDate({dateFrom:Date}) AND toDate({dateTo:Date})
          AND price > 0
          AND ({useMaxLeg:UInt8} = 0 OR price <= {maxLegPrice:UInt32})
        ORDER BY price ASC
        LIMIT 10
      ) AS l${i + 1}
    `);
  }

  let joinClause = legSubqueries[0]!;
  for (let i = 1; i < legs.length; i++) {
    const prev = `l${i}`;
    const next = `l${i + 1}`;
    const stayMin = `l${i}_stay_min`;
    const stayMax = `l${i}_stay_max`;
    if (legs[i]!.stayMin != null && legs[i]!.stayMax != null) {
      params[`l${i}_stay_min`] = legs[i]!.stayMin!;
      params[`l${i}_stay_max`] = legs[i]!.stayMax!;
      joinClause += `
        INNER JOIN ${legSubqueries[i]!}
          ON ${next}.origin_iata      = ${prev}.destination_iata
         AND ${next}.departure_date   >= ${prev}.departure_date + INTERVAL {${stayMin}:UInt32} DAY
         AND ${next}.departure_date   <= ${prev}.departure_date + INTERVAL {${stayMax}:UInt32} DAY
      `;
    } else {
      joinClause += `
        INNER JOIN ${legSubqueries[i]!}
          ON ${next}.origin_iata      = ${prev}.destination_iata
         AND ${next}.departure_date   >= ${prev}.departure_date
      `;
    }
  }

  const selectParts: string[] = [];
  for (let i = 0; i < legs.length; i++) {
    const alias = `l${i + 1}`;
    selectParts.push(
      `${alias}.flight_number    AS l${i + 1}_flight`,
      `${alias}.origin_iata      AS l${i + 1}_from`,
      `${alias}.destination_iata AS l${i + 1}_to`,
      `${alias}.departure_date   AS l${i + 1}_departure`,
      `${alias}.arrival_datetime AS l${i + 1}_arrival`,
      `${alias}.price            AS l${i + 1}_price`,
      `${alias}.currency         AS l${i + 1}_currency`,
    );
  }
  const totalExpr = legs.map((_, i) => `l${i + 1}.price`).join(" + ");
  const currencyRef = `l1.currency`;

  const anchorClauses: string[] = [];
  if (q.anchor && /^[A-Z]{3}$/.test(escapeIata(q.anchor.city)) && /^\d{4}-\d{2}-\d{2}$/.test(q.anchor.day)) {
    const anchorCity = escapeIata(q.anchor.city);
    const anchorDay = q.anchor.day;
    params.anchorCity = anchorCity;
    params.anchorDay = anchorDay;
    const arrivingIdx = legs.findIndex((l) => l.to === anchorCity);
    const departingIdx = legs.findIndex((l) => l.from === anchorCity);
    if (arrivingIdx === -1 || departingIdx === -1) {
      throw new Error(`anchor city ${anchorCity} must match one of the stop IATAs`);
    }
    anchorClauses.push(
      `toDate(l${arrivingIdx + 1}.arrival_datetime) <= toDate({anchorDay:Date})`,
      `l${departingIdx + 1}.departure_date > toDate({anchorDay:Date})`,
    );
  }

  const whereClauses = [
    `toDate(l${legs.length}.arrival_datetime) <= toDate({dateTo:Date})`,
    `({useMaxTotal:UInt8} = 0 OR (${totalExpr}) <= {maxTotalPrice:UInt32})`,
    ...anchorClauses,
  ];

  const query = `
SELECT
  ${selectParts.join(",\n  ")},
  (${totalExpr}) AS total_price,
  ${currencyRef} AS currency,
  dateDiff('day', l1.departure_date, l${legs.length}.departure_date) AS trip_days
FROM ${joinClause}
WHERE ${whereClauses.join("\n  AND ")}
ORDER BY total_price ASC
LIMIT {limit:UInt32}
  `.trim();

  return { query, params };
}

export async function findMultiCityBestFare(
  q: MultiCityBestFareQuery,
): Promise<MultiCityBestFareResult> {
  const requestedFrom = q.dateFrom;
  const requestedTo = q.dateTo;
  const clamped = await clampToDataWindow(requestedFrom, requestedTo, { minDays: 1 });

  const defaultStayDays = Math.max(1, Math.min(30, Math.floor(q.defaultStayDays ?? 3)));
  const defaultFlexDays = Math.max(0, Math.min(7, Math.floor(q.defaultFlexDays ?? 1)));
  const stops = resolveStops(q.stops, defaultStayDays, defaultFlexDays);

  const home = escapeIata(q.homeIata ?? process.env.WAYFARE_HOME ?? "STN");
  if (!/^[A-Z]{3}$/.test(home)) throw new Error(`invalid home IATA: ${q.homeIata}`);
  if (stops.some((s) => s.iata === home)) {
    throw new Error(`stop cannot equal home airport (${home})`);
  }

  const { query, params } = buildMultiCityBestFareQuery(home, stops, q, clamped.dateFrom, clamped.dateTo);

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
  log.info("multi-city best fare SQL", {
    home,
    stops: stops.map((s) => ({ iata: s.iata, stay: `${s.minStay}-${s.maxStay}d` })),
    window: { requested: { from: requestedFrom, to: requestedTo }, used: { from: clamped.dateFrom, to: clamped.dateTo }, truncated: clamped.truncated },
    anchor: q.anchor ?? null,
    rows: rows.length,
    ms: Date.now() - startedAt,
  });

  const legCount = legsTotal(stops);
  const bundles: MultiCityBestFareBundle[] = rows.map((row) => {
    const legs: MultiCityBestFareLeg[] = [];
    for (let i = 0; i < legCount; i++) {
      const n = i + 1;
      const departureDateRaw = row[`l${n}_departure`];
      const departureDate =
        departureDateRaw instanceof Date
          ? isoDate(departureDateRaw)
          : String(departureDateRaw ?? "").slice(0, 10);
      const arrivalRaw = row[`l${n}_arrival`];
      legs.push({
        from: String(row[`l${n}_from`] ?? ""),
        to: String(row[`l${n}_to`] ?? ""),
        departureDate,
        arrivalDatetime:
          arrivalRaw == null
            ? null
            : (arrivalRaw instanceof Date ? arrivalRaw.toISOString().slice(0, 19) : String(arrivalRaw).slice(0, 19)),
        flightNumber: String(row[`l${n}_flight`] ?? ""),
        price: Number(row[`l${n}_price`] ?? 0),
        currency: String(row[`l${n}_currency`] ?? "EUR"),
      });
    }
    return {
      legs,
      totalPrice: Number(row.total_price ?? 0),
      currency: String(row.currency ?? "EUR"),
      tripDays: Number(row.trip_days ?? 0),
    };
  });

  return {
    bundles,
    query: {
      stops: stops.map((s) => ({ iata: s.iata, minStayDays: s.minStay, maxStayDays: s.maxStay })),
      homeIata: home,
      dateFrom: requestedFrom,
      dateTo: requestedTo,
      defaultStayDays,
      defaultFlexDays,
      legFlexDays: Math.max(0, Math.min(7, Math.floor(q.legFlexDays ?? 2))),
      maxTotalPrice: Math.max(0, Math.floor(q.maxTotalPrice ?? 0)),
      maxLegPrice: Math.max(0, Math.floor(q.maxLegPrice ?? 0)),
      anchor: q.anchor ?? null,
      limit: Math.max(1, Math.min(100, Math.floor(q.limit ?? 20))),
    },
    window: {
      dateFrom: requestedFrom,
      dateTo: requestedTo,
      clampedDateFrom: clamped.dateFrom,
      clampedDateTo: clamped.dateTo,
      truncated: clamped.truncated,
      maxDate: clamped.maxDate,
    },
    generatedSql: resolveQuery(query, params),
  };
}

function legsTotal(stops: ResolvedStop[]): number {
  return stops.length + 1;
}
