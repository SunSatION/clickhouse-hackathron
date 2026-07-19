import "dotenv/config";

import { runMigrations } from "../src/db/migrate";
import {
  syncRyanairRoutes,
  syncRyanairRoutesFromAirports,
  RYANAIR_DEFAULT_BASES,
} from "../src/airlines/ryanair";
import { parseIataList } from "../src/lib/cli-helpers";

type Source = "dynamic" | "bases";

function parseArgs(argv: string[]): {
  source: Source;
  concurrency: number;
  origins: string[] | undefined;
  showHelp: boolean;
} {
  const out = {
    source: "dynamic" as Source,
    concurrency: 1,
    origins: undefined as string[] | undefined,
    showHelp: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--source") {
      const s = argv[++i] as Source | undefined;
      if (s !== "dynamic" && s !== "bases") {
        throw new Error(`Unknown --source: ${s}. Use 'dynamic' or 'bases'.`);
      }
      out.source = s;
    } else if (a === "--concurrency") {
      const n = Number(argv[++i]);
      if (Number.isFinite(n) && n > 0) out.concurrency = Math.floor(n);
    } else if (a === "--origins") {
      out.origins = parseIataList(argv[++i]);
    } else if (a === "--help" || a === "-h") {
      out.showHelp = true;
    }
  }
  return out;
}

function printHelp(): void {
  console.log(
    "Usage: tsx scripts/sync-ryanair-routes.ts [--source dynamic|bases] [options]\n" +
      "\nSyncs Ryanair (origin, destination) routes into the airline_routes table.\n" +
      "\nSources:\n" +
      "  dynamic (default)\n" +
      "      Fetch every active Ryanair airport from\n" +
      "        /api/views/locate/5/airports/en/active\n" +
      "      then call /api/locate/v4/routes for each origin. Slower but complete.\n" +
      "      (Often blocked from this machine by WAF; see AGENTS.md Decision #3.)\n" +
      "\n" +
      "  bases\n" +
      "      Use the static RYANAIR_DEFAULT_BASES list from src/airlines/ryanair.ts,\n" +
      "      optionally overridden by --origins <CSV> or RYANAIR_ORIGINS env var.\n" +
      "      Faster; only covers 199 known bases.\n" +
      "\nOptions:\n" +
      "  --concurrency N        Parallel workers (default 1; applies to 'dynamic').\n" +
      "  --origins MLA,STN,...  Override origins (applies to 'bases' source)."
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.showHelp) {
    printHelp();
    return;
  }

  await runMigrations();

  if (args.source === "dynamic") {
    console.log(`Syncing Ryanair routes (source=dynamic, concurrency=${args.concurrency})...`);
    const summary = await syncRyanairRoutesFromAirports({
      concurrency: args.concurrency,
      onProgress: (done, total, origin, n) => {
        const tag = n < 0 ? "FAIL" : `${n} dests`;
        console.log(`  [${done}/${total}] ${origin}: ${tag}`);
      },
    });
    console.log(`\nDone in ${(summary.durationMs / 1000).toFixed(1)}s`);
    console.log(`  Active airports: ${summary.airports}`);
    console.log(`  Origins synced:  ${summary.originsSucceeded}`);
    console.log(`  Origins failed:  ${summary.originsFailed.length}`);
    console.log(`  Total (origin, dest) pairs: ${summary.totalDestinations}`);
    if (summary.originsFailed.length > 0) {
      console.log("\nFailures:");
      for (const f of summary.originsFailed.slice(0, 20)) {
        console.log(`  ${f.origin}: ${f.error}`);
      }
      if (summary.originsFailed.length > 20) {
        console.log(`  ... +${summary.originsFailed.length - 20} more`);
      }
    }
    return;
  }

  // --source bases
  const envOrigins = parseIataList(process.env.RYANAIR_ORIGINS);

  const origins =
    args.origins && args.origins.length > 0
      ? args.origins
      : envOrigins.length > 0
      ? envOrigins
      : Array.from(RYANAIR_DEFAULT_BASES);

  console.log(`Syncing Ryanair routes (source=bases, ${origins.length} origins)...`);
  const counts = await syncRyanairRoutes(origins);
  for (const [origin, n] of counts) {
    console.log(`  ${origin}: ${n} destinations`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
