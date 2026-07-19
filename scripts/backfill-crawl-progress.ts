import { config } from "dotenv";
config({ path: ".env" });

import { getClickHouse } from "../src/db/clickhouse";

type Mode = "rows" | "mark-failed";

function parseArgs(argv: string[]): { mode: Mode; dryRun: boolean; errorMessage: string } {
  const out: { mode: Mode; dryRun: boolean; errorMessage: string } = {
    mode: "rows",
    dryRun: false,
    errorMessage: "Ryanair terms-of-use not accepted (backfilled)",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--mode") {
      const m = argv[++i] as Mode | undefined;
      if (m !== "rows" && m !== "mark-failed") {
        throw new Error(`Unknown --mode: ${m}. Use 'rows' or 'mark-failed'.`);
      }
      out.mode = m;
    } else if (a === "--dry-run") {
      out.dryRun = true;
    } else if (a === "--error-message") {
      out.errorMessage = argv[++i] ?? out.errorMessage;
    } else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: tsx scripts/backfill-crawl-progress.ts [options]\n" +
          "\nTargets crawl_progress_latest rows where status='completed' AND rows_inserted=0.\n" +
          "Inserts a corrected terminal row (latest by inserted_at).\n" +
          "\nModes:\n" +
          "  rows (default)  Recompute rows_inserted from flight_listings by counting\n" +
          "                  matching rows. Preserves status='completed'.\n" +
          "  mark-failed     Reclassify the row as status='failed' with the configured\n" +
          "                  error_message. For Ryanair ToU rejections.\n" +
          "\nOptions:\n" +
          "  --dry-run                       Print a preview of rows that would change (rows mode only).\n" +
          "  --error-message <text>          Error message to write in mark-failed mode (default: Ryanair ToU)."
      );
      process.exit(0);
    }
  }
  return out;
}

const TARGET_QUERY = `
  SELECT * FROM crawl_progress_latest
  WHERE status = 'completed' AND rows_inserted = 0
`;

async function preview(): Promise<void> {
  const ch = getClickHouse();
  const rs = await ch.query({
    query: `
      WITH current AS (${TARGET_QUERY})
      SELECT
        current.airline,
        current.origin_iata,
        current.destination_iata,
        current.date_from,
        current.date_to,
        current.rows_inserted AS current_rows_inserted,
        greatest(
          current.rows_inserted,
          toUInt32(coalesce((
            SELECT count()
            FROM flight_listings fl
            WHERE fl.airline = current.airline
              AND fl.origin_iata = current.origin_iata
              AND fl.destination_iata = current.destination_iata
              AND fl.departure_date >= current.date_from
              AND fl.departure_date <= current.date_to
          ), 0))
        ) AS recomputed_rows_inserted
      FROM current
      ORDER BY current.airline, current.origin_iata, current.destination_iata
      LIMIT 50
    `,
    format: "JSONEachRow",
  });
  const rows = (await rs.json()) as Array<Record<string, unknown>>;
  console.table(rows);
}

async function backfillRows(): Promise<void> {
  const ch = getClickHouse();
  await ch.command({
    query: `
      INSERT INTO crawl_progress
      WITH current AS (${TARGET_QUERY})
      SELECT
        current.airline,
        current.origin_iata,
        current.destination_iata,
        current.date_from,
        current.date_to,
        current.status,
        current.crawl_run_id,
        greatest(
          current.rows_inserted,
          toUInt32(coalesce((
            SELECT count()
            FROM flight_listings fl
            WHERE fl.airline = current.airline
              AND fl.origin_iata = current.origin_iata
              AND fl.destination_iata = current.destination_iata
              AND fl.departure_date >= current.date_from
              AND fl.departure_date <= current.date_to
          ), 0))
        ) AS rows_inserted,
        current.error_message,
        current.started_at,
        now() AS completed_at
      FROM current
    `,
  });
}

async function markFailed(errorMessage: string): Promise<void> {
  const ch = getClickHouse();
  await ch.command({
    query: `
      INSERT INTO crawl_progress
      WITH current AS (${TARGET_QUERY})
      SELECT
        current.airline,
        current.origin_iata,
        current.destination_iata,
        current.date_from,
        current.date_to,
        'failed' AS status,
        current.crawl_run_id,
        0 AS rows_inserted,
        {errorMessage:String} AS error_message,
        current.started_at,
        now() AS completed_at
      FROM current
    `,
    query_params: { errorMessage },
  });
}

async function countTargets(): Promise<number> {
  const ch = getClickHouse();
  const rs = await ch.query({
    query: `WITH current AS (${TARGET_QUERY}) SELECT count() AS n FROM current`,
    format: "JSONEachRow",
  });
  const [row] = (await rs.json()) as Array<{ n: string | number }>;
  return Number(row?.n ?? 0);
}

async function main(): Promise<void> {
  const cfg = parseArgs(process.argv.slice(2));
  const ch = getClickHouse();

  const n = await countTargets();
  if (cfg.mode === "rows") {
    console.log(`Will recompute rows_inserted for ${n} destinations.`);
    if (n === 0) return;
    if (cfg.dryRun) {
      await preview();
      return;
    }
    await backfillRows();
    console.log("Backfill (rows) complete.");
  } else {
    console.log(
      `Will mark ${n} destinations as failed (error_message="${cfg.errorMessage}").`
    );
    if (n === 0) return;
    await markFailed(cfg.errorMessage);
    console.log("Backfill (mark-failed) complete.");
  }

  await ch.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
