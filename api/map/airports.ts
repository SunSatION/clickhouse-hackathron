import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
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

interface AirportIndex {
  generatedAt: string;
  count: number;
  airports: Airport[];
}

function airportsJsonPath(): string {
  return join(process.cwd(), "public", "data", "airports.json");
}

function loadFromDisk(): AirportIndex {
  const path = airportsJsonPath();
  if (!existsSync(path)) {
    throw new Error("airports.json not found");
  }
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as AirportIndex;
}

function listAllAirports(): Airport[] {
  return loadFromDisk().airports;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const airline = typeof req.query.airline === "string" && req.query.airline
      ? req.query.airline
      : "Ryanair";

    const all = listAllAirports();
    const code = airline.toUpperCase();

    const rows: AirportWithRouteCount[] = all.map((a) => ({
      ...a,
      originCount: 0,
      destinationCount: 0,
    }));

    res.json({
      ok: true,
      airline,
      count: rows.length,
      airports: rows,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
}
