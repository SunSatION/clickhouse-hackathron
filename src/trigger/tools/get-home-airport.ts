import { z } from "zod";
import { defineTool } from "./registry.js";
import { getAirport } from '../../db/airports.js';
import { getClickHouse } from '../../db/clickhouse.js';
import { findCheapestDestinations } from '../../db/fare-finder.js';

const DEFAULT_DESTINATION_LIMIT = 12;

function defaultDateRange(): { dateFrom: string; dateTo: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 3, 0));
  return {
    dateFrom: start.toISOString().slice(0, 10),
    dateTo: end.toISOString().slice(0, 10),
  };
}

export const ToolGetHomeAirport = defineTool({
  id: "tool-get-home-airport",
  name: "get_home_airport",
  description:
    "Resolve the user's home airport. Call this FIRST before any other tool if the user has not specified an origin. Inputs are tried in priority order: (1) explicit iata from the saved #set-home user setting — pass it via the 'iata' parameter, (2) browser geolocation lat/lon → nearest airport via ClickHouse geoDistance (biased toward airports with flight data), (3) IP geolocation → lat/lon → nearest airport, (4) country code → most-common airport in that country, (5) dataset default. The server also ambient-injects the saved home IATA automatically. Returns the IATA code plus airport metadata.",
  schema: z.object({
    iata: z.string().length(3).optional().describe("Explicit home airport IATA (user saved preference)."),
    country: z.string().min(2).max(3).optional().describe("ISO country code, e.g. 'PT', 'GB', 'ES'."),
    ip: z.string().optional().describe("IPv4/IPv6 address for geolocation lookup."),
    lat: z.number().optional().describe("Browser geolocation latitude."),
    lon: z.number().optional().describe("Browser geolocation longitude."),
  }),
  handler: async ({ iata, country, ip, lat, lon }) => {
    const ch = getClickHouse();

    if (iata) {
      const airport = getAirport(iata.toUpperCase());
      if (!airport) return { ok: false, error: `unknown IATA: ${iata}` };
      return { ok: true, source: "explicit", iata: airport.iata, airport };
    }

    let resolvedLat: number | null = null;
    let resolvedLon: number | null = null;
    let resolvedCountry: string | null = country?.toUpperCase() ?? null;
    let coordSource: string | null = null;

    if (lat != null && lon != null) {
      resolvedLat = lat;
      resolvedLon = lon;
      coordSource = "browser-geolocation";
    } else if (ip) {
      try {
        const cleanIp = ip.replace(/^::ffff:/, "");
        const geoRes = await fetch(`http://ip-api.com/json/${cleanIp}?fields=status,countryCode,lat,lon`);
        const geo = (await geoRes.json()) as { status?: string; countryCode?: string; lat?: number; lon?: number };
        if (geo?.status === "success") {
          if (typeof geo.lat === "number" && typeof geo.lon === "number") {
            resolvedLat = geo.lat;
            resolvedLon = geo.lon;
            coordSource = "ip-geolocation";
          }
          if (!resolvedCountry && geo.countryCode) resolvedCountry = geo.countryCode.toUpperCase();
        }
      } catch {
        /* ignore */
      }
    }

    if (resolvedLat != null && resolvedLon != null) {
      try {
        const nearest = await findNearestAirportWithFlights(ch, resolvedLat, resolvedLon, resolvedCountry ?? undefined);
        if (nearest) {
          return {
            ok: true,
            source: coordSource ?? "coordinates",
            iata: nearest.iata,
            airport: nearest,
            note: `nearest airport to (${resolvedLat.toFixed(4)}, ${resolvedLon.toFixed(4)}) via ClickHouse geoDistance${nearest.distanceKm != null ? ` — ${nearest.distanceKm.toFixed(1)} km` : ""}${nearest.hasFlights ? ` · has flight data` : ""}`,
            distanceKm: nearest.distanceKm ?? null,
          };
        }
      } catch {
        /* fall through to country lookup */
      }
    }

    if (resolvedCountry) {
      const airport = await mostCommonAirportInCountry(ch, resolvedCountry);
      if (airport) {
        return {
          ok: true,
          source: resolvedCountry,
          iata: airport.iata,
          airport,
          note: `most common departure airport in ${resolvedCountry} from flight listings`,
        };
      }
      const nearest = await findNearestAirportInCountry(ch, resolvedCountry, resolvedLat, resolvedLon);
      if (nearest) {
        return { ok: true, source: `${resolvedCountry} (no flight data)`, iata: nearest.iata, airport: nearest };
      }
      return { ok: false, error: `country ${resolvedCountry} not found in airport dataset` };
    }

    const defaultRows = await ch.query({
      query: `
        SELECT origin_iata AS iata, count() AS n
        FROM flight_listings_latest
        WHERE origin_iata != ''
        GROUP BY origin_iata
        ORDER BY n DESC
        LIMIT 1
      `,
      format: "JSONEachRow",
    });
    const top = (await defaultRows.json()) as Array<{ iata: string }>;
    const topRow = top[0];
    if (topRow) {
      const airport = getAirport(String(topRow.iata));
      if (airport) return { ok: true, source: "dataset-default", iata: airport.iata, airport };
    }

    return { ok: false, error: "could not resolve home airport from any source" };
  },
});

interface AirportWithDistance {
  iata: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
  type: string;
  distanceKm?: number;
  hasFlights?: boolean;
  flightCount?: number;
}

async function findNearestAirportWithFlights(
  ch: ReturnType<typeof getClickHouse>,
  lat: number,
  lon: number,
  _country?: string,
): Promise<AirportWithDistance | null> {
  const rows = await ch.query({
    query: `
      WITH coords AS (
        SELECT
          iata, name, city, country, region, lat, lon, type,
          geoDistance(lon, lat, {lon:Float64}, {lat:Float64}) / 1000.0 AS distance_km
        FROM airports
        WHERE lat IS NOT NULL AND lon IS NOT NULL
      ),
      with_flights AS (
        SELECT c.*, count(fl.origin_iata) AS flight_count
        FROM coords c
        LEFT JOIN flight_listings_latest fl ON fl.origin_iata = c.iata
        GROUP BY c.iata, c.name, c.city, c.country, c.region, c.lat, c.lon, c.type, c.distance_km
      )
      SELECT
        iata, name, city, country, region, lat, lon, type, distance_km,
        flight_count,
        if(flight_count > 0, 1, 0) AS has_flights
      FROM with_flights
      ORDER BY
        if(flight_count > 0, 0, 1) ASC,
        distance_km ASC
      LIMIT 5
    `,
    query_params: { lat, lon },
    format: "JSONEachRow",
  });
  const results = (await rows.json()) as Array<{
    iata: string;
    name: string;
    city: string;
    country: string;
    region: string;
    lat: string;
    lon: string;
    type: string;
    distance_km: string;
    flight_count: string;
    has_flights: number;
  }>;
  if (results.length === 0) return null;
  const top = results[0]!;
  return {
    iata: String(top.iata),
    name: String(top.name),
    city: String(top.city),
    country: String(top.country),
    lat: Number(top.lat),
    lon: Number(top.lon),
    type: String(top.type),
    distanceKm: Number(top.distance_km),
    hasFlights: Number(top.has_flights) === 1,
    flightCount: Number(top.flight_count),
  };
}

async function findNearestAirportInCountry(
  ch: ReturnType<typeof getClickHouse>,
  country: string,
  lat: number | null,
  lon: number | null,
): Promise<AirportWithDistance | null> {
  if (lat == null || lon == null) {
    const rows = await ch.query({
      query: `SELECT iata, name, city, country, lat, lon, type FROM airports WHERE country = {country:String} AND lat != 0 AND lon != 0 ORDER BY iata LIMIT 1`,
      query_params: { country: country.toUpperCase() },
      format: "JSONEachRow",
    });
    const r = ((await rows.json()) as Array<{ iata: string; name: string; city: string; country: string; lat: string; lon: string; type: string }>)[0];
    if (!r) return null;
    return {
      iata: String(r.iata),
      name: String(r.name),
      city: String(r.city),
      country: String(r.country),
      lat: Number(r.lat),
      lon: Number(r.lon),
      type: String(r.type),
    };
  }
  const rows = await ch.query({
    query: `
      SELECT iata, name, city, country, lat, lon, type,
        geoDistance(lon, lat, {lon:Float64}, {lat:Float64}) / 1000.0 AS distance_km
      FROM airports
      WHERE country = {country:String} AND lat != 0 AND lon != 0
      ORDER BY distance_km ASC
      LIMIT 1
    `,
    query_params: { country: country.toUpperCase(), lat, lon },
    format: "JSONEachRow",
  });
  const r = ((await rows.json()) as Array<{
    iata: string; name: string; city: string; country: string; lat: string; lon: string; type: string; distance_km: string;
  }>)[0];
  if (!r) return null;
  return {
    iata: String(r.iata),
    name: String(r.name),
    city: String(r.city),
    country: String(r.country),
    lat: Number(r.lat),
    lon: Number(r.lon),
    type: String(r.type),
    distanceKm: Number(r.distance_km),
  };
}

async function mostCommonAirportInCountry(
  ch: ReturnType<typeof getClickHouse>,
  country: string,
): Promise<AirportWithDistance | null> {
  const rows = await ch.query({
    query: `
      SELECT origin_iata AS iata, count() AS n
      FROM flight_listings_latest
      WHERE origin_iata != ''
      GROUP BY origin_iata
      ORDER BY n DESC
      LIMIT 500
    `,
    format: "JSONEachRow",
  });
  const allOrigins = (await rows.json()) as Array<{ iata: string; n: string }>;
  const lookupRs = await ch.query({
    query: `SELECT iata, name, city, country, lat, lon, type FROM airports WHERE country = {country:String}`,
    query_params: { country: country.toUpperCase() },
    format: "JSONEachRow",
  });
  const airports = (await lookupRs.json()) as Array<{ iata: string; name: string; city: string; country: string; lat: string; lon: string; type: string }>;
  const byIata = new Map(airports.map((a) => [String(a.iata).toUpperCase(), a]));
  for (const row of allOrigins) {
    const iata = String(row.iata).toUpperCase();
    const a = byIata.get(iata);
    if (a) {
      return {
        iata,
        name: String(a.name),
        city: String(a.city),
        country: String(a.country),
        lat: Number(a.lat),
        lon: Number(a.lon),
        type: String(a.type),
        flightCount: Number(row.n),
      };
    }
  }
  return null;
}
