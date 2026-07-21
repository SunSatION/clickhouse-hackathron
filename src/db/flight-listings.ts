import {
  FlightListingSchema,
  type FlightListingInput,
} from "../lib/flight-listing.js";
import { getClickHouse } from "./clickhouse.js";

const STAGING_TABLES: Record<string, string> = {
  Ryanair: "ryanair_listings",
  EasyJet: "easyjet_listings",
};

const SUPPORTED_AIRLINES = new Set(Object.keys(STAGING_TABLES));

export function listSupportedAirlines(): string[] {
  return Object.keys(STAGING_TABLES);
}

export function stagingTableFor(airline: string): string | null {
  return STAGING_TABLES[airline] ?? null;
}

export function isSupportedAirline(airline: string): boolean {
  return SUPPORTED_AIRLINES.has(airline);
}

async function buildStagingRows(
  rows: FlightListingInput[],
  crawlRunId: string
) {
  return rows.map((row) => {
    return {
      airline: row.airline,
      airline_code: row.airline_code,
      origin_iata: row.origin_iata,
      destination_iata: row.destination_iata,
      flight_number: row.flight_number,
      departure_date: row.departure_date,
      departure_datetime: row.departure_datetime,
      arrival_datetime: row.arrival_datetime,
      duration_minutes: row.duration_minutes,
      currency: row.currency,
      price: row.price.toFixed(2),
      original_price:
        row.original_price === null
          ? null
          : row.original_price.toFixed(2),
      fare_type: row.fare_type,
      fare_class: row.fare_class,
      seats_left: row.seats_left,
      observed_at: row.observed_at,
      source: row.source,
      search_origin: row.search_origin,
      raw: row.raw,
      crawl_run_id: crawlRunId,
    };
  });
}

export async function insertStagingListings(
  airline: string,
  rows: FlightListingInput[],
  crawlRunId: string
): Promise<number> {
  const table = stagingTableFor(airline);
  if (!table) {
    throw new Error(
      `Airline ${airline} has no staging table; supported: ${[...SUPPORTED_AIRLINES].join(", ")}`
    );
  }
  if (rows.length === 0) return 0;
  const values = await buildStagingRows(rows, crawlRunId);
  await getClickHouse().insert({
    table,
    format: "JSONEachRow",
    values,
  });
  return values.length;
}

export async function insertRyanairListings(
  rows: FlightListingInput[],
  crawlRunId: string
): Promise<number> {
  return insertStagingListings("Ryanair", rows, crawlRunId);
}

export async function insertEasyjetListings(
  rows: FlightListingInput[],
  crawlRunId: string
): Promise<number> {
  if (rows.length === 0) return 0;
  const values = rows.map((row) => {
    return {
      airline: row.airline,
      airline_code: row.airline_code,
      origin_iata: row.origin_iata,
      destination_iata: row.destination_iata,
      departure_date: row.departure_date,
      departure_datetime: row.departure_datetime,
      arrival_datetime: row.arrival_datetime,
      currency: row.currency,
      price: row.price.toFixed(2),
      original_price:
        row.original_price === null
          ? null
          : row.original_price.toFixed(2),
      fare_type: row.fare_type,
      fare_class: row.fare_class,
      seats_left: row.seats_left,
      observed_at: row.observed_at,
      source: row.source,
      search_origin: row.search_origin,
      raw: row.raw,
      crawl_run_id: crawlRunId,
    };
  });
  await getClickHouse().insert({
    table: "easyjet_listings",
    format: "JSONEachRow",
    values,
  });
  return values.length;
}

export async function getRecentlyObservedDepartureDates(
  airline: string,
  originIata: string,
  sinceMinutes: number
): Promise<Set<string>> {
  const safeSince = Math.max(
    1,
    Math.min(Math.floor(sinceMinutes), 60 * 24 * 30)
  );
  const result = await getClickHouse().query({
    query: `
      SELECT departure_date AS date
      FROM flight_listings
      WHERE airline = {airline:String}
        AND origin_iata = {origin:String}
        AND observed_at >= now() - INTERVAL {minutes:UInt32} MINUTE
      GROUP BY date
      HAVING max(observed_at) >= now() - INTERVAL {minutes:UInt32} MINUTE
    `,
    query_params: {
      airline,
      origin: originIata.toUpperCase(),
      minutes: safeSince,
    },
    format: "JSONEachRow",
  });
  const rows = (await result.json()) as Array<{ date: string }>;
  return new Set(rows.map((r) => String(r.date)));
}

export async function getRecentlySeenKeys(opts: {
  airline: string;
  sinceMinutes: number;
}): Promise<Set<string>> {
  const safeSince = Math.max(
    1,
    Math.min(Math.floor(opts.sinceMinutes), 60 * 24 * 30)
  );
  const result = await getClickHouse().query({
    query: `
      SELECT origin_iata AS origin, departure_date AS date
      FROM flight_listings
      WHERE airline = {airline:String}
        AND observed_at >= now() - INTERVAL {minutes:UInt32} MINUTE
      GROUP BY origin, date
    `,
    query_params: { airline: opts.airline, minutes: safeSince },
    format: "JSONEachRow",
  });
  const rows = (await result.json()) as Array<{
    origin: string;
    date: string;
  }>;
  return new Set(
    rows.map((r) => `${r.origin}|${typeof r.date === "string" ? r.date : String(r.date)}`)
  );
}
