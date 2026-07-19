import { config } from "dotenv";
config({ path: ".env" });

import { runMigrations } from "../src/db/migrate";
import { getClickHouse } from "../src/db/clickhouse";

async function main() {
  const ch = getClickHouse();

  console.log("Applying migrations...");
  const result = await runMigrations();
  console.log(`  Applied: ${result.applied.join(", ") || "none"}`);
  console.log(`  Skipped: ${result.skipped.join(", ")}`);

  console.log("\nVerifying views exist...");
  const views = ["flight_listings_latest", "ryanair_listings_latest", "easyjet_listings_latest"];
  for (const view of views) {
    const rs = await ch.query({
      query: "EXISTS TABLE {name:Identifier}",
      query_params: { name: view },
      format: "JSONEachRow",
    });
    const rows = (await rs.json()) as Array<{ result: number }>;
    const exists = rows[0]?.result === 1;
    console.log(`  ${view}: ${exists ? "OK" : "MISSING"}`);
  }

  console.log("\nSmoke-testing flight_listings_latest (LIMIT 3)...");
  const sample = await ch.query({
    query: "SELECT * FROM flight_listings_latest LIMIT 3",
    format: "JSONEachRow",
  });
  const rows = (await sample.json()) as unknown[];
  console.table(rows);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration run failed:", err);
    process.exit(1);
  });