import { config } from "dotenv";
config({ path: ".env" });

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getClickHouse } from "../src/db/clickhouse";
import { installFetchInstrumentation } from "../src/observability/fetch-instrumentation";

interface AirportRow {
  iata: string;
  name: string;
  city?: string;
  country?: string;
  region?: string;
  lat?: number;
  lon?: number;
  type?: string;
}

const PATHS = [
  join(process.cwd(), "public", "data", "airports.json"),
  join(process.cwd(), "..", "public", "data", "airports.json"),
];

function loadAirports(): AirportRow[] {
  for (const p of PATHS) {
    if (existsSync(p)) {
      const raw = JSON.parse(readFileSync(p, "utf8")) as { airports: AirportRow[] };
      return raw.airports ?? [];
    }
  }
  throw new Error("airports.json not found in public/data");
}

async function main() {
  installFetchInstrumentation();
  const ch = getClickHouse();

  const airports = loadAirports();
  const valid = airports
    .filter((a) => /^[A-Z0-9]{3}$/i.test(String(a.iata ?? "")) && Number.isFinite(a.lat) && Number.isFinite(a.lon))
    .map((a) => ({
      iata: String(a.iata).toUpperCase(),
      name: String(a.name ?? ""),
      city: String(a.city ?? ""),
      country: String(a.country ?? ""),
      region: String(a.region ?? ""),
      lat: Number(a.lat),
      lon: Number(a.lon),
      type: String(a.type ?? ""),
    }));
  console.log(`Loaded ${valid.length} airports with coordinates (skipped ${airports.length - valid.length} without coords).`);

  const existsRs = await ch.query({
    query: "EXISTS TABLE airports",
    format: "JSONEachRow",
  });
  const exists = ((await existsRs.json()) as Array<{ result: number }>)[0]?.result === 1;
  if (!exists) {
    throw new Error("airports table missing — run scripts/run-migrations.ts first.");
  }

  console.log("Truncating airports…");
  await ch.command({ query: "TRUNCATE TABLE airports" });

  const CHUNK = 1000;
  let inserted = 0;
  for (let i = 0; i < valid.length; i += CHUNK) {
    const slice = valid.slice(i, i + CHUNK);
    await ch.insert({
      table: "airports",
      format: "JSONEachRow",
      values: slice,
    });
    inserted += slice.length;
    console.log(`  inserted ${inserted}/${valid.length}`);
  }

  const countRs = await ch.query({ query: "SELECT count() AS n FROM airports", format: "JSONEachRow" });
  const count = ((await countRs.json()) as Array<{ n: string }>)[0]?.n;
  console.log(`Done — airports row count: ${count}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("load-airports failed:", err);
    process.exit(1);
  });
