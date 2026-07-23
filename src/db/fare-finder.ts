import { getClickHouse } from "./clickhouse.js";
import { clampToDataWindow } from "./data-window.js";
import { getAirport } from "./airports.js";

export interface FareFinderDateRange {
  dateFrom: string;
  dateTo: string;
}

export interface ClampedDateRange extends FareFinderDateRange {
  truncated: boolean;
  maxDate: string;
  requestedFrom: string;
  requestedTo: string;
}

export type QueryResult<T> = { results: T[]; window: ClampedDateRange };

async function clampRange(dateFrom: string, dateTo: string): Promise<ClampedDateRange> {
  const c = await clampToDataWindow(dateFrom, dateTo);
  return {
    dateFrom: c.dateFrom,
    dateTo: c.dateTo,
    requestedFrom: dateFrom,
    requestedTo: dateTo,
    truncated: c.truncated,
    maxDate: c.maxDate,
  };
}

export interface InspirationQuery {
  origin: string;
  dateFrom: string;
  dateTo: string;
  airline?: string;
  airlineCode?: string;
  maxPrice?: number;
  excludeCountries?: string[];
  limit?: number;
}

export interface DestinationDeal {
  iata: string;
  bestPrice: number;
  currency: string;
  bestDate: string;
  bestAirline: string;
  nFlights: number;
  nDates: number;
  bestDurationMinutes: number | null;
  city: string | null;
  country: string | null;
}

export interface FastestRoute {
  origin: string;
  destination: string;
  bestDate: string;
  durationMinutes: number | null;
  price: number;
  currency: string;
  airline: string;
}

export interface OriginCompareRow {
  origin: string;
  destination: string;
  bestPrice: number;
  currency: string;
  bestDate: string;
  bestAirline: string;
  durationMinutes: number | null;
}

export async function findCheapestDestinations(q: InspirationQuery): Promise<QueryResult<DestinationDeal>> {
  const ch = getClickHouse();
  const origin = q.origin.toUpperCase();
  const limit = Math.max(1, Math.min(50, q.limit ?? 12));
  const airlineCode = (q.airlineCode ?? "").toUpperCase();
  const airlineName = q.airline ?? "";
  const maxPrice = typeof q.maxPrice === "number" && q.maxPrice > 0 ? q.maxPrice : 0;
  const useMaxPrice = maxPrice > 0;
  const window = await clampRange(q.dateFrom, q.dateTo);
  const queryParams: Record<string, unknown> = {
    origin,
    dateFrom: window.dateFrom,
    dateTo: window.dateTo,
    airlineCode,
    airlineName,
    maxPrice,
    useMaxPrice: useMaxPrice ? 1 : 0,
    limit,
  };

  const r = await ch.query({
    query: `
      SELECT
        destination_iata AS iata,
        min(price) AS best_price,
        any(currency) AS currency,
        argMin(departure_date, price) AS best_date,
        any(airline) AS best_airline,
        argMin(duration_minutes, price) AS best_duration_minutes,
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
    format: "JSONEachRow",
  });

  const rows = (await r.json()) as Array<Record<string, unknown>>;
  const results = await Promise.all(rows.map(async (row) => {
    const iata = String(row.iata ?? "").toUpperCase();
    const ap = await getAirport(iata);
    return {
      iata,
      bestPrice: Number(row.best_price ?? 0),
      currency: String(row.currency ?? "EUR"),
      bestDate: String(row.best_date ?? "").slice(0, 10),
      bestAirline: String(row.best_airline ?? ""),
      nFlights: Number(row.n_flights ?? 0),
      nDates: Number(row.n_dates ?? 0),
      bestDurationMinutes:
        row.best_duration_minutes != null && row.best_duration_minutes !== 0
          ? Number(row.best_duration_minutes)
          : null,
      city: ap?.city ?? null,
      country: ap?.country ?? null,
    };
  }));
  return { results, window };
}

export interface CalendarQuery {
  origin: string;
  destination: string;
  dateFrom: string;
  dateTo: string;
  airline?: string;
  airlineCode?: string;
  maxPrice?: number;
  limit?: number;
}

export interface CalendarCell {
  date: string;
  bestPrice: number;
  currency: string;
  bestAirline: string;
  flights: number;
  cheapestDepartureDatetime: string | null;
  durationMinutes: number | null;
}

export async function findCheapestDates(q: CalendarQuery): Promise<QueryResult<CalendarCell>> {
  const ch = getClickHouse();
  const origin = q.origin.toUpperCase();
  const destination = q.destination.toUpperCase();
  const limit = Math.max(1, Math.min(120, q.limit ?? 60));
  const airlineCode = (q.airlineCode ?? "").toUpperCase();
  const airlineName = q.airline ?? "";
  const maxPrice = typeof q.maxPrice === "number" && q.maxPrice > 0 ? q.maxPrice : 0;
  const useMaxPrice = maxPrice > 0;
  const window = await clampRange(q.dateFrom, q.dateTo);

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
      dateFrom: window.dateFrom,
      dateTo: window.dateTo,
      airlineCode,
      airlineName,
      maxPrice,
      useMaxPrice: useMaxPrice ? 1 : 0,
      limit,
    },
    format: "JSONEachRow",
  });

  const rows = (await r.json()) as Array<Record<string, unknown>>;
  const results = rows.map((row) => ({
    date: String(row.d ?? "").slice(0, 10),
    bestPrice: Number(row.best_price ?? 0),
    currency: String(row.currency ?? "EUR"),
    bestAirline: String(row.best_airline ?? ""),
    flights: Number(row.flights ?? 0),
    cheapestDepartureDatetime: row.best_dt ? String(row.best_dt).slice(0, 19) : null,
    durationMinutes: row.duration_minutes != null ? Number(row.duration_minutes) : null,
  }));
  return { results, window };
}

export interface RoundTripQuery {
  origin: string;
  destination: string;
  dateFrom: string;
  dateTo: string;
  minDays?: number;
  maxDays?: number;
  airlineCode?: string;
  limit?: number;
}

export interface RoundTripBundle {
  origin: string;
  destination: string;
  outboundDate: string;
  outboundDepartureDatetime: string | null;
  outboundAirline: string;
  outboundPrice: number;
  returnDate: string;
  returnDepartureDatetime: string | null;
  returnAirline: string;
  returnPrice: number;
  totalPrice: number;
  currency: string;
  tripDays: number;
}

export async function findBestRoundTrip(q: RoundTripQuery): Promise<QueryResult<RoundTripBundle>> {
  const ch = getClickHouse();
  const origin = q.origin.toUpperCase();
  const destination = q.destination.toUpperCase();
  const minDays = Math.max(1, Math.min(60, q.minDays ?? 3));
  const maxDays = Math.max(minDays, Math.min(60, q.maxDays ?? 14));
  const limit = Math.max(1, Math.min(50, q.limit ?? 5));
  const airlineCode = (q.airlineCode ?? "").toUpperCase();
  const useAirline = airlineCode.length > 0 ? 1 : 0;
  const window = await clampRange(q.dateFrom, q.dateTo);

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
      dateFrom: window.dateFrom,
      dateTo: window.dateTo,
      minDays,
      maxDays,
      limit,
      airlineCode,
      useAirline,
    },
    format: "JSONEachRow",
  });

  const rows = (await r.json()) as Array<Record<string, unknown>>;
  const results = rows.map((row) => ({
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
    tripDays: Number(row.trip_days ?? 0),
  }));
  return { results, window };
}

export interface OneWayCheapest {
  origin: string;
  destination: string;
  date: string;
  price: number;
  currency: string;
  airline: string;
  departureDatetime: string | null;
  durationMinutes: number | null;
}

export async function findBestOneWay(q: CalendarQuery): Promise<QueryResult<OneWayCheapest>> {
  const ch = getClickHouse();
  const origin = q.origin.toUpperCase();
  const destination = q.destination.toUpperCase();
  const limit = Math.max(1, Math.min(60, q.limit ?? 10));
  const airlineCode = (q.airlineCode ?? "").toUpperCase();
  const useAirline = airlineCode.length > 0 ? 1 : 0;
  const window = await clampRange(q.dateFrom, q.dateTo);

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
      dateFrom: window.dateFrom,
      dateTo: window.dateTo,
      airlineCode,
      useAirline,
      limit,
    },
    format: "JSONEachRow",
  });

  const rows = (await r.json()) as Array<Record<string, unknown>>;
  const results = rows.map((row) => ({
    origin,
    destination,
    date: String(row.d ?? "").slice(0, 10),
    price: Number(row.best_price ?? 0),
    currency: String(row.currency ?? "EUR"),
    airline: String(row.best_airline ?? ""),
    departureDatetime: row.best_dt ? String(row.best_dt).slice(0, 19) : null,
    durationMinutes: row.duration_minutes != null ? Number(row.duration_minutes) : null,
  }));
  return { results, window };
}

export interface MultiOriginQuery {
  origins: string[];
  destination?: string;
  dateFrom: string;
  dateTo: string;
  excludeAirlines?: string[];
  limit?: number;
}

export interface MultiOriginDeal {
  bestOrigin: string;
  destination: string;
  bestPrice: number;
  currency: string;
  bestDate: string;
  bestAirline: string;
  alternativeOrigins: Array<{ origin: string; price: number; date: string }>;
  city: string | null;
  country: string | null;
}

export async function findCheapestFromAnyOrigin(q: MultiOriginQuery): Promise<QueryResult<MultiOriginDeal>> {
  const ch = getClickHouse();
  const origins = Array.from(new Set(q.origins.map((o) => o.toUpperCase())));
  if (origins.length === 0) return { results: [], window: await clampRange(q.dateFrom, q.dateTo) };
  const limit = Math.max(1, Math.min(50, q.limit ?? 10));
  const dest = (q.destination ?? "").toUpperCase();
  const window = await clampRange(q.dateFrom, q.dateTo);

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
      dateFrom: window.dateFrom,
      dateTo: window.dateTo,
    },
    format: "JSONEachRow",
  });

  const rows = (await r.json()) as Array<Record<string, unknown>>;
  const grouped = new Map<string, MultiOriginDeal>();
  for (const row of rows) {
    const o = String(row.origin_iata ?? "").toUpperCase();
    const d = String(row.destination_iata ?? "").toUpperCase();
    const price = Number(row.best_price ?? 0);
    if (!grouped.has(d)) {
      const ap = await getAirport(d);
      grouped.set(d, {
        bestOrigin: o,
        destination: d,
        bestPrice: price,
        currency: String(row.currency ?? "EUR"),
        bestDate: String(row.best_date ?? "").slice(0, 10),
        bestAirline: String(row.best_airline ?? ""),
        alternativeOrigins: [],
        city: ap?.city ?? null,
        country: ap?.country ?? null,
      });
    }
    const cur = grouped.get(d)!;
    cur.alternativeOrigins.push({
      origin: o,
      price,
      date: String(row.best_date ?? "").slice(0, 10),
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
  const results = Array.from(grouped.values())
    .sort((a, b) => a.bestPrice - b.bestPrice)
    .slice(0, limit);
  return { results, window };
}

export interface FastestQuery {
  origins: string[];
  destination: string;
  dateFrom: string;
  dateTo: string;
  airlineCode?: string;
  limit?: number;
}

export async function findFastestFromAnyOrigin(q: FastestQuery): Promise<QueryResult<FastestRoute>> {
  const ch = getClickHouse();
  const origins = Array.from(new Set(q.origins.map((o) => o.toUpperCase())));
  const window = await clampRange(q.dateFrom, q.dateTo);
  if (origins.length === 0) return { results: [], window };
  const destination = q.destination.toUpperCase();
  const limit = Math.max(1, Math.min(20, q.limit ?? 5));
  const airlineCode = (q.airlineCode ?? "").toUpperCase();
  const useAirline = airlineCode.length > 0 ? 1 : 0;

  const r = await ch.query({
    query: `
      SELECT
        origin_iata,
        argMin(departure_date, duration_minutes) AS best_date,
        min(duration_minutes) AS duration_minutes,
        argMin(price, duration_minutes) AS price,
        any(currency) AS currency,
        argMin(airline, duration_minutes) AS airline
      FROM flight_listings_latest
      WHERE origin_iata IN {origins:Array(String)}
        AND destination_iata = {destination:String}
        AND departure_date BETWEEN {dateFrom:Date} AND {dateTo:Date}
        AND price > 0
        AND duration_minutes > 0
        AND ({useAirline:UInt8} = 0 OR airline_code = {airlineCode:String})
      GROUP BY origin_iata
      ORDER BY duration_minutes ASC
      LIMIT {limit:UInt32}
    `,
    query_params: {
      origins,
      destination,
      dateFrom: window.dateFrom,
      dateTo: window.dateTo,
      airlineCode,
      useAirline,
    },
    format: "JSONEachRow",
  });

  const rows = (await r.json()) as Array<Record<string, unknown>>;
  const results = rows.map((row) => ({
    origin: String(row.origin_iata ?? "").toUpperCase(),
    destination,
    bestDate: String(row.best_date ?? "").slice(0, 10),
    durationMinutes: row.duration_minutes != null ? Number(row.duration_minutes) : null,
    price: Number(row.price ?? 0),
    currency: String(row.currency ?? "EUR"),
    airline: String(row.airline ?? ""),
  }));
  return { results, window };
}

export interface CompareOriginsQuery {
  origins: string[];
  destination: string;
  dateFrom: string;
  dateTo: string;
  airlineCode?: string;
}

export async function compareOrigins(q: CompareOriginsQuery): Promise<QueryResult<OriginCompareRow>> {
  const ch = getClickHouse();
  const origins = Array.from(new Set(q.origins.map((o) => o.toUpperCase())));
  const window = await clampRange(q.dateFrom, q.dateTo);
  if (origins.length === 0) return { results: [], window };
  const destination = q.destination.toUpperCase();
  const airlineCode = (q.airlineCode ?? "").toUpperCase();
  const useAirline = airlineCode.length > 0 ? 1 : 0;

  const r = await ch.query({
    query: `
      SELECT
        origin_iata,
        min(price) AS best_price,
        any(currency) AS currency,
        argMin(departure_date, price) AS best_date,
        any(airline) AS best_airline,
        argMin(duration_minutes, price) AS duration_minutes
      FROM flight_listings_latest
      WHERE origin_iata IN {origins:Array(String)}
        AND destination_iata = {destination:String}
        AND departure_date BETWEEN {dateFrom:Date} AND {dateTo:Date}
        AND price > 0
        AND ({useAirline:UInt8} = 0 OR airline_code = {airlineCode:String})
      GROUP BY origin_iata
      ORDER BY best_price ASC
    `,
    query_params: {
      origins,
      destination,
      dateFrom: window.dateFrom,
      dateTo: window.dateTo,
      airlineCode,
      useAirline,
    },
    format: "JSONEachRow",
  });

  const rows = (await r.json()) as Array<Record<string, unknown>>;
  const results = rows.map((row) => ({
    origin: String(row.origin_iata ?? "").toUpperCase(),
    destination,
    bestPrice: Number(row.best_price ?? 0),
    currency: String(row.currency ?? "EUR"),
    bestDate: String(row.best_date ?? "").slice(0, 10),
    bestAirline: String(row.best_airline ?? ""),
    durationMinutes:
      row.duration_minutes != null && row.duration_minutes !== 0 ? Number(row.duration_minutes) : null,
  }));
  return { results, window };
}

export interface WeekendQuery {
  origin: string;
  destination: string;
  dateFrom: string;
  dateTo: string;
  nightCount?: number;
  airlineCode?: string;
  limit?: number;
}

export interface WeekendDeal {
  origin: string;
  destination: string;
  outboundDate: string;
  returnDate: string;
  outboundPrice: number;
  returnPrice: number;
  totalPrice: number;
  currency: string;
  outboundAirline: string;
  returnAirline: string;
  nights: number;
}

export async function findWeekendDeals(q: WeekendQuery): Promise<QueryResult<WeekendDeal>> {
  const ch = getClickHouse();
  const origin = q.origin.toUpperCase();
  const destination = q.destination.toUpperCase();
  const nights = Math.max(1, Math.min(21, q.nightCount ?? 4));
  const limit = Math.max(1, Math.min(20, q.limit ?? 5));
  const airlineCode = (q.airlineCode ?? "").toUpperCase();
  const useAirline = airlineCode.length > 0 ? 1 : 0;
  const window = await clampRange(q.dateFrom, q.dateTo);

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
      dateFrom: window.dateFrom,
      dateTo: window.dateTo,
      nights,
      limit,
      airlineCode,
      useAirline,
    },
    format: "JSONEachRow",
  });

  const rows = (await r.json()) as Array<Record<string, unknown>>;
  const results = rows.map((row) => {
    const outboundDate = String(row.outbound_date ?? "").slice(0, 10);
    const returnDate = String(row.return_date ?? "").slice(0, 10);
    const tripDays = Math.round(
      (new Date(returnDate + "T00:00:00Z").getTime() - new Date(outboundDate + "T00:00:00Z").getTime()) /
        86_400_000,
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
      nights: Math.max(0, tripDays - 1),
    };
  });
  return { results, window };
}

export interface FreshnessRow {
  route: string;
  maxObservedAt: string;
  distinctDates: number;
}

export async function getDatasetFreshness(): Promise<{
  byAirline: Array<{ airline: string; maxObservedAt: string; rows: number; routes: number }>;
  byAirlineRoutes: FreshnessRow[];
  overallMax: string | null;
  overallRows: number;
}> {
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
    format: "JSONEachRow",
  });
  const a = (await r.json()) as Array<Record<string, unknown>>;
  const r2 = await ch.query({
    query: `
      SELECT
        concat(origin_iata, '→', destination_iata) AS route,
        max(latest_observed_at) AS max_observed_at,
        uniqExact(departure_date) AS distinct_dates
      FROM flight_listings_latest
      GROUP BY route
      ORDER BY max_observed_at DESC
      LIMIT 50
    `,
    format: "JSONEachRow",
  });
  const rr = (await r2.json()) as Array<Record<string, unknown>>;
  const byAirlineRoutes: FreshnessRow[] = rr.map((row) => ({
    route: String(row.route ?? ""),
    maxObservedAt: String(row.max_observed_at ?? ""),
    distinctDates: Number(row.distinct_dates ?? 0),
  }));
  let overallMax: string | null = null;
  let overallRows = 0;
  const byAirline = a.map((row) => {
    const maxObs = String(row.max_observed_at ?? "");
    if (!overallMax || maxObs > overallMax) overallMax = maxObs;
    overallRows += Number(row.rows ?? 0);
    return {
      airline: String(row.airline ?? ""),
      maxObservedAt: maxObs,
      rows: Number(row.rows ?? 0),
      routes: Number(row.routes ?? 0),
    };
  });
  return { byAirline, byAirlineRoutes, overallMax, overallRows };
}

export interface LlmToolHints {
  freshness: {
    overallMaxObservedAt: string | null;
    overallRows: number;
    byAirline: Array<{ airline: string; rows: number; maxObservedAt: string }>;
  };
  warnings: string[];
}

export function buildToolHints(
  result: Awaited<ReturnType<typeof getDatasetFreshness>>,
): LlmToolHints {
  const warnings: string[] = [];
  if (!result.overallMax) warnings.push("No flight data available — recommend refreshing the crawl.");
  else {
    const ageMs = Date.now() - new Date(result.overallMax).getTime();
    const ageHours = ageMs / 3_600_000;
    if (ageHours > 168) warnings.push(`Data is ${Math.round(ageHours / 24)} days stale — recommend refreshing before quoting prices.`);
    else if (ageHours > 48) warnings.push(`Data is ${Math.round(ageHours)} hours old — within freshness SLA but quote with observed_at if precision matters.`);
  }
  if (result.overallRows < 100) warnings.push(`Only ${result.overallRows} fares loaded — coverage is thin.`);
  return {
    freshness: {
      overallMaxObservedAt: result.overallMax,
      overallRows: result.overallRows,
      byAirline: result.byAirline.map((a) => ({
        airline: a.airline,
        rows: a.rows,
        maxObservedAt: a.maxObservedAt,
      })),
    },
    warnings,
  };
}

export interface RankInput<T> {
  item: T;
  price: number;
  score: number;
}

export function topNByPrice<T extends { bestPrice?: number; totalPrice?: number }>(
  items: T[],
  n: number,
): T[] {
  return [...items]
    .sort((a, b) => {
      const pa = Number(a.bestPrice ?? a.totalPrice ?? 0);
      const pb = Number(b.bestPrice ?? b.totalPrice ?? 0);
      return pa - pb;
    })
    .slice(0, n);
}
