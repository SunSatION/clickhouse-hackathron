import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { logger } from "../src/lib/logger";

const OUT_PATH = join(import.meta.dirname, "..", "public", "data", "airports.json");
const SOURCE_URL = "https://ourairports.com/data/airports.csv";

interface AirportRow {
  ident: string;
  type: string;
  name: string;
  lat: number;
  lon: number;
  iso_country: string;
  iso_region: string;
  municipality: string;
  iata: string;
}

const log = logger("scripts/build-airports-json.ts");

function parseCsv(raw: string): AirportRow[] {
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  const headerLine = lines.shift();
  if (!headerLine) return [];
  const headers = headerLine.split(",").map((h) => h.replace(/^"|"$/g, ""));
  const idx = (k: string) => headers.indexOf(k);
  const out: AirportRow[] = [];
  for (const line of lines) {
    const cells = parseCsvLine(line);
    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) row[headers[i]] = cells[i] ?? "";
    const iata = (row.iata_code ?? "").trim();
    if (!/^[A-Z]{3}$/.test(iata)) continue;
    const lat = Number(row.latitude_deg);
    const lon = Number(row.longitude_deg);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({
      ident: row.ident ?? "",
      type: row.type ?? "",
      name: row.name ?? "",
      lat,
      lon,
      iso_country: row.iso_country ?? "",
      iso_region: row.iso_region ?? "",
      municipality: row.municipality ?? "",
      iata,
    });
  }
  return out;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === "," && !inQ) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

async function fetchCsv(): Promise<string> {
  log.info("Fetching airport CSV", { url: SOURCE_URL });
  const res = await fetch(SOURCE_URL, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${SOURCE_URL}`);
  return res.text();
}

async function main() {
  const raw = await fetchCsv();
  const all = parseCsv(raw);
  log.info("Parsed rows", { total: all.length, withIata: all.length });

  const byIata = new Map<string, AirportRow>();
  for (const r of all) {
    if (r.type === "closed") continue;
    const prev = byIata.get(r.iata);
    if (!prev || (prev.type !== "large_airport" && r.type === "large_airport")) {
      byIata.set(r.iata, r);
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    count: byIata.size,
    airports: Array.from(byIata.values())
      .sort((a, b) => a.iata.localeCompare(b.iata))
      .map((a) => ({
        iata: a.iata,
        name: a.name,
        city: a.municipality,
        country: a.iso_country,
        region: a.iso_region,
        lat: a.lat,
        lon: a.lon,
        type: a.type,
      })),
  };

  mkdirSync(join(OUT_PATH, ".."), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(payload));
  log.info("Wrote airports.json", { path: OUT_PATH, count: payload.count });
}

main().catch((err) => {
  log.error("build-airports-json failed", { error: (err as Error).message });
  process.exit(1);
});
