import "dotenv/config";

import { randomUUID } from "node:crypto";

import { CRAWL_CONFIG } from "../src/config";
import { runMigrations } from "../src/db/migrate";
import { crawlRyanairForOrigin } from "../src/airlines/ryanair";
import { defaultDateToIso, parseIataList, todayISODate } from "../src/lib/cli-helpers";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function printHelp(): void {
  console.log(
    "Usage: tsx scripts/crawl-ryanair-origin.ts --origin <IATA> [options]\n" +
      "\nCrawl Ryanair for a single origin using destinations from airline_routes.\n" +
      "Rows are persisted as each response arrives; re-runs resume automatically.\n" +
      "\nRequired:\n" +
      "  --origin <IATA>            Origin airport (e.g. MLA, STN)\n" +
      "\nOptions:\n" +
      "  --from <YYYY-MM-DD>        Default: today\n" +
      "  --to   <YYYY-MM-DD>        Default: today + 1 month\n" +
      "  --destinations CSV         Restrict to a subset of destinations\n" +
      "  --run-id <UUID>            Reuse an existing crawl run id (otherwise generated)\n" +
      "  --no-resume                Disable auto-resume from crawl_progress"
  );
}

function parseArgs(argv: string[]): {
  origin: string;
  dateFrom: string;
  dateTo: string;
  crawlRunId: string;
  resume: boolean;
  destinations?: string[];
  showHelp: boolean;
} {
  const out = {
    origin: "",
    dateFrom: "",
    dateTo: "",
    crawlRunId: "",
    resume: true,
    destinations: undefined as string[] | undefined,
    showHelp: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--origin") out.origin = (argv[++i] ?? "").toUpperCase();
    else if (a === "--from") out.dateFrom = argv[++i] ?? "";
    else if (a === "--to") out.dateTo = argv[++i] ?? "";
    else if (a === "--run-id") out.crawlRunId = argv[++i] ?? "";
    else if (a === "--no-resume") out.resume = false;
    else if (a === "--destinations" || a === "--dests") {
      out.destinations = parseIataList(argv[++i]);
    } else if (a === "--help" || a === "-h") {
      out.showHelp = true;
    }
  }

  if (!UUID_RE.test(out.crawlRunId)) {
    out.crawlRunId = randomUUID();
  }
  return {
    origin: out.origin,
    dateFrom: out.dateFrom || todayISODate(),
    dateTo: out.dateTo || defaultDateToIso(),
    crawlRunId: out.crawlRunId,
    resume: out.resume,
    destinations: out.destinations,
    showHelp: out.showHelp,
  };
}

async function main() {
  const cfg = parseArgs(process.argv);

  if (cfg.showHelp) {
    printHelp();
    process.exit(0);
  }

  if (!cfg.origin) {
    console.error("Missing required --origin <IATA>. Run with --help for usage.");
    process.exit(1);
  }

  await runMigrations();

  const observedAt = new Date();

  console.log(`Origin:       ${cfg.origin}`);
  console.log(`Dates:        ${cfg.dateFrom} .. ${cfg.dateTo}`);
  console.log(`Run:          ${cfg.crawlRunId}`);
  console.log(`Resume:       ${cfg.resume ? "yes (skips completed destinations)" : "no"}`);
  if (cfg.destinations?.length) {
    console.log(`Destination filter: ${cfg.destinations.join(", ")}`);
  }
  console.log(
    "(Destinations come from airline_routes where airline=RYANAIR & origin matches)\n"
  );

  const startedAt = Date.now();
  const result = await crawlRyanairForOrigin(cfg.origin, cfg.dateFrom, cfg.dateTo, {
    crawlRunId: cfg.crawlRunId,
    observedAt,
    adults: CRAWL_CONFIG.ryanair.adults,
    airline: "Ryanair",
    requestDelayMs: CRAWL_CONFIG.ryanair.requestDelayMs,
    requestJitterMs: CRAWL_CONFIG.ryanair.requestJitterMs,
    resumeFromProgress: cfg.resume,
    destinationFilter: cfg.destinations,
  });
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.log(`\nDone in ${elapsed}s`);
  console.log(`  Requests made: ${result.requestsMade}`);
  console.log(`  Cache hits:    ${result.cacheHits}`);
  console.log(`  Skipped:       ${result.requestsSkipped}`);
  console.log(`  Inserted:      ${result.rowsInserted}`);
  console.log(`  Errors:        ${result.errors.length}`);
  if (result.errors.length > 0) {
    for (const e of result.errors.slice(0, 5)) {
      console.log(`    - ${e.origin}@${e.date}: ${e.message}`);
    }
    if (result.errors.length > 5) console.log(`    ... +${result.errors.length - 5} more`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Crawl failed:", err);
    process.exit(1);
  });