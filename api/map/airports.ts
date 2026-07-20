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

async function fetchAirportsJson(): Promise<Airport[]> {
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "https://clickhouse-hackathron.vercel.app";
  const res = await fetch(`${baseUrl}/data/airports.json`);
  if (!res.ok) throw new Error(`Failed to fetch airports.json: ${res.status}`);
  const data = await res.json() as { airports: Airport[]; count: number; generatedAt: string };
  return data.airports;
}

let cachedAirports: Airport[] | null = null;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (!cachedAirports) {
      cachedAirports = await fetchAirportsJson();
    }
    const airline = typeof req.query.airline === "string" && req.query.airline
      ? req.query.airline
      : "Ryanair";

    const rows: AirportWithRouteCount[] = cachedAirports.map((a) => ({
      ...a,
      originCount: 0,
      destinationCount: 0,
    }));

    res.json({ ok: true, airline, count: rows.length, airports: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
}
