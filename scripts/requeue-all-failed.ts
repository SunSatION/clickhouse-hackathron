import "dotenv/config";

import { getClickHouse } from "../src/db/clickhouse";

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
        error_message,
        crawl_run_id
      FROM crawl_progress_latest
      WHERE status = 'failed'
      ORDER BY airline, origin_iata, destination_iata, date_from
    `,
    format: "JSONEachRow",
  });
  const failedRows = (await previewResult.json()) as Array<{
    airline: string;
    origin_iata: string;
    destination_iata: string;
    date_from: string;
    date_to: string;
    error_message: string;
    crawl_run_id: string;
  }>;

  if (!failedRows || failedRows.length === 0) {
    console.log("No failed crawl_progress rows found.");
    return;
  }

  console.log(
    `Found ${failedRows.length} failed rows. Preview (first 20):`
  );
  for (const r of failedRows.slice(0, 20)) {
    console.log(
      `  ${r.airline} ${r.origin_iata} -> ${r.destination_iata}  ${r.date_from}..${r.date_to}  err="${r.error_message?.slice(0, 80)}"`
    );
  }
  if (failedRows.length > 20) {
    console.log(`  ... and ${failedRows.length - 20} more`);
  }

  const now = new Date().toISOString();
  await ch.insert({
    table: "crawl_progress",
    format: "JSONEachRow",
    values: failedRows.map((r) => ({
      airline: r.airline,
      origin_iata: r.origin_iata,
      destination_iata: r.destination_iata,
      date_from: r.date_from,
      date_to: r.date_to,
      status: "pending",
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
    `\nInserted ${failedRows.length} pending rows. ` +
    `The crawl-queue-worker will pick them up on its next cycle.`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("requeue-all-failed failed:", err);
    process.exit(1);
  });
