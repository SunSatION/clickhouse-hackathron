import { getClickHouse } from "./clickhouse.js";

export interface AirlineRouteInput {
  destination_iata: string;
  destination_name?: string;
  base?: boolean;
}

export async function upsertAirlineRoutes(
  airlineCode: string,
  origin: string,
  routes: AirlineRouteInput[]
): Promise<number> {
  if (routes.length === 0) return 0;
  const upperAirline = airlineCode.toUpperCase();
  const upperOrigin = origin.toUpperCase();
  const values = routes.map((r) => ({
    airline_code: upperAirline,
    origin_iata: upperOrigin,
    destination_iata: r.destination_iata.toUpperCase(),
    destination_name: r.destination_name ?? "",
    base: r.base ?? false,
    fetched_at: new Date().toISOString(),
  }));
  await getClickHouse().insert({
    table: "airline_routes",
    format: "JSONEachRow",
    values,
  });
  return values.length;
}

export async function getDestinationsForAirlineOrigin(
  airlineCode: string,
  origin: string
): Promise<Set<string>> {
  const rs = await getClickHouse().query({
    query: `SELECT destination_iata FROM airline_routes_latest WHERE airline_code = {airline:String} AND origin_iata = {origin:String}`,
    query_params: {
      airline: airlineCode.toUpperCase(),
      origin: origin.toUpperCase(),
    },
    format: "JSONEachRow",
  });
  const rows = (await rs.json()) as Array<{ destination_iata: string }>;
  return new Set(rows.map((r) => r.destination_iata.toUpperCase()));
}

export async function getDestinationsWithNamesForAirlineOrigin(
  airlineCode: string,
  origin: string
): Promise<Map<string, string>> {
  const rs = await getClickHouse().query({
    query: `
      SELECT destination_iata, destination_name
      FROM airline_routes_latest
      WHERE airline_code = {airline:String}
        AND origin_iata = {origin:String}
    `,
    query_params: {
      airline: airlineCode.toUpperCase(),
      origin: origin.toUpperCase(),
    },
    format: "JSONEachRow",
  });
  const rows = (await rs.json()) as Array<{ destination_iata: string; destination_name: string }>;
  const map = new Map<string, string>();
  for (const r of rows) {
    map.set(r.destination_iata.toUpperCase(), r.destination_name ?? "");
  }
  return map;
}

export async function getRoutesForAirlineOrigins(
  airlineCode: string,
  origins: string[]
): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>();
  for (const o of origins) map.set(o.toUpperCase(), new Set());
  if (origins.length === 0) return map;
  const rs = await getClickHouse().query({
    query: `SELECT origin_iata, destination_iata FROM airline_routes_latest WHERE airline_code = {airline:String} AND origin_iata IN {origins:Array(String)}`,
    query_params: {
      airline: airlineCode.toUpperCase(),
      origins: origins.map((o) => o.toUpperCase()),
    },
    format: "JSONEachRow",
  });
  const rows = (await rs.json()) as Array<{
    origin_iata: string;
    destination_iata: string;
  }>;
  for (const r of rows) {
    const set = map.get(r.origin_iata.toUpperCase());
    if (set) set.add(r.destination_iata.toUpperCase());
  }
  return map;
}

export async function countAirlineRoutes(airlineCode?: string): Promise<number> {
  const rs = await getClickHouse().query({
    query: airlineCode
      ? `SELECT count() AS n FROM airline_routes_latest WHERE airline_code = {airline:String}`
      : "SELECT count() AS n FROM airline_routes_latest",
    query_params: airlineCode ? { airline: airlineCode.toUpperCase() } : undefined,
    format: "JSONEachRow",
  });
  const rows = (await rs.json()) as Array<{ n: string | number }>;
  return Number(rows[0]?.n ?? 0);
}