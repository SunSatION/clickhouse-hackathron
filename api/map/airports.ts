import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getClickHouse } from "../../src/db/clickhouse";

interface Airport {
  iata: string;
  name: string;
  city: string;
  country: string;
  region: string;
  lat: number;
  lon: number;
  type: string;
}

interface AirportWithRouteCount extends Airport {
  originCount: number;
  destinationCount: number;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const airline = typeof req.query.airline === "string" && req.query.airline
      ? req.query.airline
      : "Ryanair";
    const code = airline.toUpperCase();

    const ch = getClickHouse();

    const routesResult = await ch.query({
      query: `
        SELECT DISTINCT origin_iata AS iata
        FROM airline_routes FINAL
        WHERE airline_code = {code:String}
        UNION ALL
        SELECT DISTINCT destination_iata AS iata
        FROM airline_routes FINAL
        WHERE airline_code = {code:String}
      `,
      query_params: { code },
      format: "JSONEachRow",
    });
    const routeRows = (await routesResult.json()) as Array<{ iata: string }>;
    const iataSet = new Set(routeRows.map((r) => String(r.iata).toUpperCase()));

    const airportsResult = await ch.query({
      query: `
        SELECT iata, name, city, country, region, lat, lon, type
        FROM airports
        WHERE iata IN {iataSet:Array(String)}
      `,
      query_params: { iataSet: Array.from(iataSet) },
      format: "JSONEachRow",
    });
    const airportRows = (await airportsResult.json()) as Airport[];

    const originResult = await ch.query({
      query: `
        SELECT origin_iata AS iata, count() AS n
        FROM airline_routes FINAL
        WHERE airline_code = {code:String}
        GROUP BY origin_iata
      `,
      query_params: { code },
      format: "JSONEachRow",
    });
    const originRows = (await originResult.json()) as Array<{ iata: string; n: number }>;
    const originCountMap = new Map(originRows.map((r) => [String(r.iata).toUpperCase(), Number(r.n)]));

    const rows: AirportWithRouteCount[] = airportRows.map((a) => ({
      ...a,
      originCount: originCountMap.get(a.iata.toUpperCase()) ?? 0,
      destinationCount: 0,
    }));

    res.json({ ok: true, airline, count: rows.length, airports: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
}
