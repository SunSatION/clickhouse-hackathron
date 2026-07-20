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

let cachedAirports: Airport[] | null = null;

async function loadAirports(): Promise<Airport[]> {
  if (cachedAirports) return cachedAirports;
  const baseUrl = `https://${process.env.VERCEL_URL ?? "clickhouse-hackathron.vercel.app"}`;
  const res = await fetch(`${baseUrl}/data/airports.json`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`airports.json fetch failed: ${res.status}`);
  const json = await res.json() as { airports: Airport[] };
  cachedAirports = json.airports;
  return cachedAirports;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const airline = typeof req.query.airline === "string" && req.query.airline
      ? req.query.airline
      : "Ryanair";

    const all = await loadAirports();
    const rows: AirportWithRouteCount[] = all.map((a) => ({
      ...a,
      originCount: 0,
      destinationCount: 0,
    }));

    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({ ok: true, airline, count: rows.length, airports: rows });
  } catch (err) {
    console.error("airports handler error:", err);
    res.status(500).json({ ok: false, error: String(err) });
  }
}
