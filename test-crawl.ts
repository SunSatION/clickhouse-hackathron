import "dotenv/config";
import { createClient } from "@clickhouse/client";
import { runMigrations } from "./src/db/migrate";
import { insertRyanairListings } from "./src/db/flight-listings";
import { getClickHouse } from "./src/db/clickhouse";
import { crawlRyanairForOrigin } from "./src/airlines/ryanair";

async function main() {
  console.log("=== Local Ryanair Crawl Test ===\n");

  const chForSetup = createClient({
    url: process.env.CLICKHOUSE_URL ?? "https://clickhouse-cloud-instance:8443",
    database: "default",
  });
  await chForSetup.command({ query: "CREATE DATABASE IF NOT EXISTS flights" });
  await chForSetup.close();

  console.log("1. Applying migrations...");
  const migrationResult = await runMigrations();
  console.log(`   Applied: ${migrationResult.applied.join(", ") || "none"}`);
  console.log(`   Skipped: ${migrationResult.skipped.join(", ")}`);
  console.log();

  const crawlRunId = crypto.randomUUID();
  const origin = "MLA";
  const destinations = ["CHQ"];
  const dateFrom = "2026-08-01";
  const dateTo = "2026-08-02";

  console.log(`2. Crawling ${origin} -> ${destinations.join(", ")} (${dateFrom} to ${dateTo})...`);
  const result = await crawlRyanairForOrigin(origin, dateFrom, dateTo, {
    crawlRunId,
    observedAt: new Date(),
    adults: 1,
    destinationFilter: destinations,
    requestDelayMs: 1000,
    requestJitterMs: 200,
  });

  console.log(`   Requests made: ${result.requestsMade}`);
  console.log(`   Cache hits: ${result.cacheHits}`);
  console.log(`   Rows collected: ${result.rows.length}`);
  console.log(`   Errors: ${result.errors.length}`);
  if (result.errors.length > 0) {
    result.errors.forEach((e) => console.log(`     - ${e.origin}@${e.date}: ${e.message}`));
  }
  console.log();

  if (result.rows.length > 0) {
    console.log("3. Inserting rows into ClickHouse...");
    const inserted = await insertRyanairListings(result.rows, crawlRunId);
    console.log(`   Inserted: ${inserted} rows`);
    console.log();

    console.log("4. Sample data from flight_listings:");
    const ch = getClickHouse();
    const queryResult = await ch.query({
      query: `
        SELECT
          origin_iata,
          destination_iata,
          departure_date,
          price,
          currency,
          fare_type,
          observed_at
        FROM flight_listings
        WHERE crawl_run_id = {runId:String}
        ORDER BY price ASC
        LIMIT 10
      `,
      query_params: { runId: crawlRunId },
      format: "JSONEachRow",
    });
    const rows = await queryResult.json();
    console.table(rows);
  } else {
    console.log("3. No rows to insert, skipping.");
  }

  console.log("\n=== Done ===");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
