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
    : `http://localhost:${process.env.PORT ?? 3000}`;
  const res = await fetch(`${baseUrl}/data/airports.json`);
  if (!res.ok) throw new Error(`Failed to fetch airports.json: ${res.status}`);
  const data = await res.json() as { airports: Airport[] };
  return data.airports;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const airline = typeof req.query.airline === "string" && req.query.airline
      ? req.query.airline
      : "Ryanair";

    const all = await fetchAirportsJson();
    const code = airline.toUpperCase();

    const rows: AirportWithRouteCount[] = all.map((a) => ({
      ...a,
      originCount: 0,
      destinationCount: 0,
    }));

    res.json({ ok: true, airline, count: rows.length, airports: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
}
