import { z } from "zod";
import { defineTool } from "./registry.js";
import { describeRelaxedCriteria, findRelaxedOneWay } from '../../db/relaxed-search.js';

export const ToolBestOneWay = defineTool({
  id: "tool-best-one-way",
  name: "find_best_one_way",
  description:
    "K cheapest one-way fares for a route, one per date, sorted by price ascending. Useful when a user wants the absolute lowest ticket regardless of dates. When no exact match is found, falls back through progressively relaxed criteria (airline, max price, date window) and returns near-miss candidates tagged with which criteria were relaxed.",
  schema: z.object({
    origin: z.string().length(3),
    destination: z.string().length(3),
    dateFrom: z.string(),
    dateTo: z.string(),
    airlineCode: z.string().optional(),
    limit: z.number().int().min(1).max(60).optional().describe("Default 10."),
  }),
  handler: async ({ origin, destination, dateFrom, dateTo, airlineCode, limit }) => {
    const relaxed = await findRelaxedOneWay({ origin, destination, dateFrom, dateTo, airlineCode, limit });
    const isStrict = relaxed.hadStrictMatch;
    const rows = isStrict ? relaxed.results : relaxed.nearMisses.map((n) => n.result);
    const relaxedCriteria = isStrict ? [] : (relaxed.nearMisses[0]?.relaxedCriteria ?? []);
    const note = isStrict
      ? undefined
      : relaxed.nearMisses.length > 0
        ? `No one-way fare matched all criteria. Showing nearest matches with the ${describeRelaxedCriteria(relaxedCriteria)} relaxed.`
        : "No fares were found on this route in the available data window.";
    return {
      ok: true,
      origin: origin.toUpperCase(),
      destination: destination.toUpperCase(),
      window: relaxed.window,
      count: rows.length,
      fares: rows,
      isPartialMatch: !isStrict,
      relaxedCriteria,
      note,
    };
  },
});
