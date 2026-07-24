import { z } from "zod";
import { defineTool } from "./registry.js";
import { londonAirports } from '../../db/airports.js';
import { describeRelaxedCriteria, findRelaxedFastest } from '../../db/relaxed-search.js';

export const ToolFindFastest = defineTool({
  id: "tool-find-fastest",
  name: "find_fastest_routes",
  description:
    "Find the fastest (shortest flight duration) one-way route from any of the supplied origins to a specific destination. If `origins` is omitted, defaults to the London airport set (STN, LGW, LTN, LHR, LCY, SEN). Use this when the user asks for the 'fastest flight' from a multi-airport city or named region. When no exact match is found, falls back through progressively relaxed criteria (date window, airline) and returns near-miss candidates.",
  schema: z.object({
    destination: z.string().length(3).describe("Destination IATA code."),
    dateFrom: z.string().describe("Earliest departure date YYYY-MM-DD."),
    dateTo: z.string().describe("Latest departure date YYYY-MM-DD."),
    origins: z.array(z.string().length(3)).min(1).max(8).optional().describe("Origin IATAs. Defaults to London airports (STN, LGW, LTN, LHR, LCY, SEN) when omitted."),
    limit: z.number().int().min(1).max(8).optional().describe("Top-K origins ranked by duration (default 5)."),
  }),
  handler: async ({ destination, dateFrom, dateTo, origins, limit }) => {
    const effectiveOrigins = origins && origins.length > 0 ? origins.map((o: string) => o.toUpperCase()) : londonAirports();
    const relaxed = await findRelaxedFastest({
      origins: effectiveOrigins,
      destination,
      dateFrom,
      dateTo,
      limit: limit ?? 5,
    });
    const isStrict = relaxed.hadStrictMatch;
    const routes = isStrict ? relaxed.results : relaxed.nearMisses.map((n) => n.result);
    const relaxedCriteria = isStrict ? [] : (relaxed.nearMisses[0]?.relaxedCriteria ?? []);
    const note = isStrict
      ? undefined
      : relaxed.nearMisses.length > 0
        ? `No fast route matched the exact window. Showing nearest matches with the ${describeRelaxedCriteria(relaxedCriteria)} relaxed.`
        : "No routes were found to this destination in the available data window.";
    return {
      ok: true,
      action: "fastest_routes",
      origins: effectiveOrigins,
      destination: destination.toUpperCase(),
      window: relaxed.window,
      count: routes.length,
      routes,
      isPartialMatch: !isStrict,
      relaxedCriteria,
      note,
    };
  },
});
