import type { VercelRequest, VercelResponse } from "@vercel/node";

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

const CACHE_TTL_MS = 60_000;
let cachedAirports: { data: Airport[]; ts: number } | null = null;

async function getAirports(): Promise<Airport[]> {
  const now = Date.now();
  if (cachedAirports && now - cachedAirports.ts < CACHE_TTL_MS) {
    return cachedAirports.data;
  }
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "https://clickhouse-hackathron.vercel.app";
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), 5000);
  try {
    const res = await fetch(`${baseUrl}/data/airports.json`, {
      signal: ac.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`airports.json status: ${res.status}`);
    const json = await res.json() as { airports?: Airport[]; count?: number };
    const airports = json.airports ?? [];
    cachedAirports = { data: airports, ts: now };
    return airports;
  } catch (e) {
    clearTimeout(timeout);
    if (cachedAirports) return cachedAirports.data;
    throw e;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const airline = (typeof req.query.airline === "string" && req.query.airline)
      ? req.query.airline
      : "Ryanair";

    const all = await getAirports();
    const rows: AirportWithRouteCount[] = all.map((a) => ({
      ...a,
      originCount: 0,
      destinationCount: 0,
    }));

    res.setHeader("Cache-Control", "public, max-age=60");
    res.json({ ok: true, airline, count: rows.length, airports: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
}
