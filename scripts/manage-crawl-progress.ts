import "dotenv/config";

import {
  listProgress,
  listFailedDestinations,
  requeueDestinations,
} from "../src/db/crawl-progress";

type Mode = "list" | "failed" | "requeue";

function parseArgs(argv: string[]): {
  mode: Mode;
  airline: string;
  origin: string;
  dateFrom: string;
  dateTo: string;
  destinations?: string[];
  includeCompleted: boolean;
} {
  const args = argv.slice(2);
  let mode: Mode = "list";
  let airline = "Ryanair";
  let origin = "";
  let dateFrom = "";
  let dateTo = "";
  let destinations: string[] | undefined;
  let includeCompleted = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--list") mode = "list";
    else if (a === "--failed") mode = "failed";
    else if (a === "--requeue") mode = "requeue";
    else if (a === "--airline") airline = args[++i] ?? airline;
    else if (a === "--origin") origin = args[++i] ?? "";
    else if (a === "--from") dateFrom = args[++i] ?? "";
    else if (a === "--to") dateTo = args[++i] ?? "";
    else if (a === "--dest") {
      destinations = (args[++i] ?? "")
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
    } else if (a === "--include-completed") includeCompleted = true;
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: tsx scripts/manage-crawl-progress.ts [--list|--failed|--requeue] " +
          "--origin <IATA> --from <YYYY-MM-DD> --to <YYYY-MM-DD> " +
          "[--airline Ryanair] [--dest MLA,STN,...] [--include-completed]"
      );
      process.exit(0);
    }
  }

  if (!origin || !dateFrom || !dateTo) {
    console.error(
      "Missing required args. Use --origin, --from, --to. Run with --help for usage."
    );
    process.exit(1);
  }
  return { mode, airline, origin, dateFrom, dateTo, destinations, includeCompleted };
}

async function main() {
  const cfg = parseArgs(process.argv);

  if (cfg.mode === "list") {
    const rows = await listProgress({
      airline: cfg.airline,
      originIata: cfg.origin,
      dateFrom: cfg.dateFrom,
      dateTo: cfg.dateTo,
    });
    console.log(
      `Progress for ${cfg.airline} ${cfg.origin} ${cfg.dateFrom}..${cfg.dateTo}: ${rows.length} entries`
    );
    for (const r of rows) {
      const flag =
        r.status === "failed"
          ? "FAILED "
          : r.status === "completed"
          ? "OK     "
          : "??     ";
      const err =
        r.status === "failed" && r.error_message
          ? ` err="${r.error_message.slice(0, 80)}"`
          : "";
      console.log(
        `  ${flag} ${r.destination_iata}  rows=${r.rows_inserted}${err}`
      );
    }
    return;
  }

  if (cfg.mode === "failed") {
    const failed = await listFailedDestinations({
      airline: cfg.airline,
      originIata: cfg.origin,
      dateFrom: cfg.dateFrom,
      dateTo: cfg.dateTo,
    });
    console.log(
      `Failed destinations for ${cfg.airline} ${cfg.origin} ${cfg.dateFrom}..${cfg.dateTo}: ${failed.length}`
    );
    for (const f of failed) {
      console.log(`  ${f.destination_iata}  err="${f.error_message.slice(0, 120)}"`);
    }
    return;
  }

  if (cfg.mode === "requeue") {
    const removed = await requeueDestinations({
      airline: cfg.airline,
      originIata: cfg.origin,
      dateFrom: cfg.dateFrom,
      dateTo: cfg.dateTo,
      destinations: cfg.destinations,
      includeCompleted: cfg.includeCompleted,
    });
    const scope = cfg.destinations?.length
      ? `destinations: ${cfg.destinations.join(", ")}`
      : "all destinations";
    const types = cfg.includeCompleted ? "failed + completed" : "failed only";
    console.log(
      `Requeued ${removed} progress entries for ${cfg.airline} ${cfg.origin} ${cfg.dateFrom}..${cfg.dateTo} (${types}, ${scope}).`
    );
    console.log(
      "Re-run the crawl; previously completed/failed entries will be re-crawled."
    );
    return;
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("manage-crawl-progress failed:", err);
    process.exit(1);
  });
