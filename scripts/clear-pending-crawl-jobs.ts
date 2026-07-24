import "dotenv/config";

import { getClickHouse } from "../src/db/clickhouse.js";

async function main() {
  const ch = getClickHouse();

  const previewResult = await ch.query({
    query: `
      SELECT
        airline,
        origin_iata,
        destination_iata,
        date_from,
        date_to,
        crawl_run_id,
        inserted_at
      FROM crawl_progress_latest
      WHERE status = 'pending'
      ORDER BY airline, origin_iata, destination_iata, date_from
    `,
    format: "JSONEachRow",
  });
  const pendingRows = (await previewResult.json()) as Array<{
    airline: string;
    origin_iata: string;
    destination_iata: string;
    date_from: string;
    date_to: string;
    crawl_run_id: string;
    inserted_at: string;
  }>;

  if (!pendingRows || pendingRows.length === 0) {
    console.log("No pending crawl_progress rows found.");
    return;
  }

  console.log(
    `Found ${pendingRows.length} pending rows. Preview (first 20):`
  );
  for (const r of pendingRows.slice(0, 20)) {
    console.log(
      `  ${r.airline} ${r.origin_iata} -> ${r.destination_iata}  ${r.date_from}..${r.date_to}`
    );
  }
  if (pendingRows.length > 20) {
    console.log(`  ... and ${pendingRows.length - 20} more`);
  }

  const now = new Date().toISOString();
  await ch.insert({
    table: "crawl_progress",
    format: "JSONEachRow",
    values: pendingRows.map((r) => ({
      airline: r.airline,
      origin_iata: r.origin_iata,
      destination_iata: r.destination_iata,
      date_from: r.date_from,
      date_to: r.date_to,
      status: "completed",
      crawl_run_id: r.crawl_run_id,
      rows_inserted: 0,
      error_message: "",
      started_at: now,
      completed_at: now,
      inserted_at: now,
      updated_at: now,
    })),
  });

  console.log(
    `\nCleared ${pendingRows.length} pending rows by marking as completed.`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("clear-pending-crawl-jobs failed:", err);
    process.exit(1);
  });
