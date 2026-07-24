import { z } from "zod";
import { defineTool } from "./registry.js";
import { describeRelaxedCriteria, findRelaxedDestinations } from '../../db/relaxed-search.js';

export const ToolCheapestDestinations = defineTool({
  id: "tool-cheapest-destinations",
  name: "find_cheapest_destinations",
  description:
    "Inspiration search: returns the N cheapest destinations reachable from a given origin within a date range, ranked by best price. Use this when the user has not picked a destination yet ('where can I fly cheaply from MLA in September?'). When no fares match the strict criteria, falls back through progressively relaxed criteria (max price, airline, date window) and returns near-miss candidates tagged with which criteria were relaxed.",
  schema: z.object({
    origin: z.string().length(3).describe("Origin IATA code (e.g. MLA, STN, BCN)."),
    dateFrom: z.string().describe("Earliest departure date YYYY-MM-DD."),
    dateTo: z.string().describe("Latest departure date YYYY-MM-DD."),
    airline: z.string().optional().describe("Restrict to airline display name (e.g. 'Ryanair')."),
    airlineCode: z.string().optional().describe("Restrict to airline IATA code (e.g. 'FR', 'EZY')."),
    maxPrice: z.number().optional().describe("Drop fares above this EUR-equivalent price."),
    limit: z.number().int().min(1).max(50).optional().describe("How many destinations to return (default 12)."),
  }),
  handler: async ({ origin, dateFrom, dateTo, airline, airlineCode, maxPrice, limit }) => {
    const relaxed = await findRelaxedDestinations({ origin, dateFrom, dateTo, airline, airlineCode, maxPrice, limit });
    const isStrict = relaxed.hadStrictMatch;
    const deals = isStrict ? relaxed.results : relaxed.nearMisses.map((n) => n.result);
    const relaxedCriteria = isStrict ? [] : (relaxed.nearMisses[0]?.relaxedCriteria ?? []);
    const note = isStrict
      ? undefined
      : relaxed.nearMisses.length > 0
        ? `No destination matched all criteria from this origin. Showing the nearest matches with the ${describeRelaxedCriteria(relaxedCriteria)} relaxed.`
        : "No fares were found from this origin in the available data window.";
    return {
      ok: true,
      origin: origin.toUpperCase(),
      window: relaxed.window,
      count: deals.length,
      destinations: deals,
      isPartialMatch: !isStrict,
      relaxedCriteria,
      note,
    };
  },
});
