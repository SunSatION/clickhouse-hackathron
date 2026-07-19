import "dotenv/config";
import { randomUUID } from "node:crypto";

import { tasks } from "@trigger.dev/sdk";

import { CRAWL_CONFIG } from "../src/config";
import { RYANAIR_DEFAULT_BASES } from "../src/airlines/ryanair";
import { defaultDateToIso, parseIataList, todayISODate } from "../src/lib/cli-helpers";

const TASK_ID = "crawl-ryanair-range";

type TriggerInput = {
  crawlRunId: string;
  origins: string[];
  dateFrom: string;
  dateTo: string;
  destinationFilter?: string[];
  adults: number;
  requestDelayMs: number;
  requestJitterMs: number;
  cooldownMs: number;
};

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a) continue;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i += 1;
      } else {
        out[key] = "true";
      }
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const dateFrom = args.from ?? todayISODate();
  const dateTo = args.to ?? defaultDateToIso();

  const originsRaw = args.origins ?? "";
  const useDefault = originsRaw.trim() === "";
  const origins = useDefault
    ? Array.from(RYANAIR_DEFAULT_BASES)
    : parseIataList(originsRaw);
  if (origins.length === 0) {
    throw new Error(
      "No origins resolved. Pass --origins MLA,STN or set RYANAIR_ORIGINS."
    );
  }

  const crawlRunId = args["run-id"] ?? randomUUID();
  const destinationFilter = args.destinations
    ? parseIataList(args.destinations)
    : undefined;

  const payload: TriggerInput = {
    crawlRunId,
    origins,
    dateFrom,
    dateTo,
    destinationFilter,
    adults: Number(args.adults ?? String(CRAWL_CONFIG.ryanair.adults)),
    requestDelayMs: Number(args.delay ?? String(CRAWL_CONFIG.ryanair.requestDelayMs)),
    requestJitterMs: Number(args.jitter ?? String(CRAWL_CONFIG.ryanair.requestJitterMs)),
    cooldownMs: Number(args.cooldown ?? String(CRAWL_CONFIG.ryanair.cooldownMs)),
  };

  console.log(`Triggering ${TASK_ID}`);
  console.log(JSON.stringify(payload, null, 2));
  console.log(
    `\nOrigins: ${origins.length}${useDefault ? " (all Ryanair bases — ~5 days at project pacing; pass --origins MLA for a single origin)" : ""}`
  );

  const handle = await tasks.trigger<
    typeof import("../src/trigger/crawl-ryanair-range").crawlRyanairRange
  >(TASK_ID, payload);

  console.log(`\nTriggered run: ${handle.id}`);
  console.log(`Crawl run id: ${crawlRunId}`);
}

main().catch((err) => {
  console.error("Failed to trigger crawl:", err);
  process.exit(1);
});