import { planBestItinerary } from "../src/db/itinerary-planner";

process.env.CLICKHOUSE_DATABASE = "flights";

function fmt(it: Awaited<ReturnType<typeof planBestItinerary>>[number]) {
  return it.legs
    .map(
      (l) =>
        `    ${l.origin}→${l.destination}  ${l.departureDatetime} (arr ${l.arrivalDatetime})  ${l.price} ${l.currency}  ${l.airline}`,
    )
    .join("\n");
}

async function main() {
  console.log("\n=== 3 stops (single SQL): MLA + {STN, BCN, FCO} Aug 1-31, 2026 ===");
  const started3 = Date.now();
  const r3 = await planBestItinerary({
    home: "MLA",
    stops: ["STN", "BCN", "FCO"],
    dateFrom: "2026-08-01",
    dateTo: "2026-08-31",
    bufferDays: 1,
    topK: 3,
  });
  console.log(`Took ${Date.now() - started3}ms, ${r3.length} result(s)`);
  for (const it of r3) {
    console.log(
      `  total=${it.totalPrice.toFixed(2)} ${it.currency}  perm=${it.permutation.join("→")}  dur=${it.totalDurationMinutes}m`,
    );
    console.log(fmt(it));
  }

  console.log("\n=== 4 stops (single SQL): MLA + {STN, BCN, FCO, ATH} Aug 1-31, 2026 ===");
  const started4 = Date.now();
  const r4 = await planBestItinerary({
    home: "MLA",
    stops: ["STN", "BCN", "FCO", "ATH"],
    dateFrom: "2026-08-01",
    dateTo: "2026-08-31",
    bufferDays: 1,
    topK: 1,
  });
  console.log(`Took ${Date.now() - started4}ms, ${r4.length} result(s)`);
  for (const it of r4) {
    console.log(
      `  total=${it.totalPrice.toFixed(2)} ${it.currency}  perm=${it.permutation.join("→")}  dur=${it.totalDurationMinutes}m`,
    );
    console.log(fmt(it));
  }

  console.log("\n=== 5 stops (single SQL): MLA + {STN, BCN, FCO, ATH, MAD} Aug 1-31, 2026 ===");
  const started5 = Date.now();
  const r5 = await planBestItinerary({
    home: "MLA",
    stops: ["STN", "BCN", "FCO", "ATH", "MAD"],
    dateFrom: "2026-08-01",
    dateTo: "2026-08-31",
    bufferDays: 1,
    topK: 1,
  });
  console.log(`Took ${Date.now() - started5}ms, ${r5.length} result(s)`);
  for (const it of r5) {
    console.log(
      `  total=${it.totalPrice.toFixed(2)} ${it.currency}  perm=${it.permutation.join("→")}  dur=${it.totalDurationMinutes}m`,
    );
    console.log(fmt(it));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });