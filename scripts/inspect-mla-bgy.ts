import "dotenv/config";

import { getCurrentRowState, getQueueStats } from "../src/db/crawl-progress";
import { getClickHouse } from "../src/db/clickhouse";

(async () => {
  console.log("=== Ryanair queue stats ===");
  console.log(await getQueueStats({ airline: "Ryanair" }));

  console.log("\n=== MLA->BGY 2026-08-01..2026-09-01 (all rows) ===");
  console.log(
    await getCurrentRowState({
      airline: "Ryanair",
      originIata: "MLA",
      destinationIata: "BGY",
      dateFrom: "2026-08-01",
      dateTo: "2026-09-01",
    })
  );

  const ch = getClickHouse();

  console.log("\n=== currently processing rows (top 5) ===");
  console.log(
    await (
      await ch.query({
        query:
          "SELECT origin_iata, destination_iata, crawl_run_id, started_at, inserted_at FROM crawl_progress_latest WHERE status='processing' ORDER BY started_at DESC LIMIT 5 FORMAT JSONEachRow",
        format: "JSONEachRow",
      })
    ).json()
  );

  console.log("\n=== last 5 worker.item spans ===");
  console.log(
    await (
      await ch.query({
        query:
          "SELECT Timestamp, SpanAttributes['origin.iata'] AS o, SpanAttributes['currentDestination'] AS d FROM otel.otel_traces WHERE SpanName='crawl.worker.item' ORDER BY Timestamp DESC LIMIT 5 FORMAT JSONEachRow",
        format: "JSONEachRow",
      })
    ).json()
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
