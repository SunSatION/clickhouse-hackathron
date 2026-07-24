import { z } from "zod";
import { defineTool } from "./registry.js";
import { describeRelaxedCriteria, findRelaxedRoundTrip } from '../../db/relaxed-search.js';

export const ToolBestRoundTrip = defineTool({
  id: "tool-best-round-trip",
  name: "find_best_round_trip",
  description:
    "Bundle search: joins the cheapest outbound and return legs into priced round-trip bundles ranked by total price, respecting min/max trip length. Replaces the older TS-based pairing logic with a single ClickHouse self-join — answers 'cheapest round trip A↔B for a N-day holiday'. When no exact match is found, falls back through progressively relaxed criteria (airline, date window, trip length) and returns near-miss candidates tagged with which criteria were relaxed.",
  schema: z.object({
    origin: z.string().length(3),
    destination: z.string().length(3),
    dateFrom: z.string(),
    dateTo: z.string(),
    minDays: z.number().int().min(1).max(60).optional().describe("Min trip length in days (default 3)."),
    maxDays: z.number().int().min(1).max(60).optional().describe("Max trip length in days (default 14)."),
    airlineCode: z.string().optional(),
    limit: z.number().int().min(1).max(50).optional().describe("Top-K bundles (default 5)."),
  }),
  handler: async ({ origin, destination, dateFrom, dateTo, minDays, maxDays, airlineCode, limit }) => {
    const relaxed = await findRelaxedRoundTrip({ origin, destination, dateFrom, dateTo, minDays, maxDays, airlineCode, limit });
    const isStrict = relaxed.hadStrictMatch;
    const bundles = isStrict ? relaxed.results : relaxed.nearMisses.map((n) => n.result);
    const relaxedCriteria = isStrict ? [] : (relaxed.nearMisses[0]?.relaxedCriteria ?? []);
    const note = isStrict
      ? undefined
      : relaxed.nearMisses.length > 0
        ? `No round trip matched all criteria. Showing nearest matches with the ${describeRelaxedCriteria(relaxedCriteria)} relaxed.`
        : "No round trips were found between these airports in the available data window.";
    return {
      ok: true,
      origin: origin.toUpperCase(),
      destination: destination.toUpperCase(),
      window: { ...relaxed.window, minDays: minDays ?? 3, maxDays: maxDays ?? 14 },
      count: bundles.length,
      options: bundles,
      isPartialMatch: !isStrict,
      relaxedCriteria,
      note,
    };
  },
});
