import { z } from "zod";
import { defineTool } from "./registry.js";
import { compareOrigins } from '../../db/fare-finder.js';

export const ToolCompareOrigins = defineTool({
  id: "tool-compare-origins",
  name: "compare_origins",
  description:
    "Side-by-side comparison of multiple origins to a single destination: returns one row per origin with best price, best date, airline, and duration. Use this when the user explicitly asks to compare origins ('compare STN and LGW to DUB') rather than pick the cheapest single origin.",
  schema: z.object({
    origins: z.array(z.string().length(3)).min(2).max(8).describe("Origin IATAs to compare (at least 2)."),
    destination: z.string().length(3).describe("Destination IATA code."),
    dateFrom: z.string().describe("Earliest departure date YYYY-MM-DD."),
    dateTo: z.string().describe("Latest departure date YYYY-MM-DD."),
  }),
  handler: async ({ origins, destination, dateFrom, dateTo }) => {
    const { results: rows, window } = await compareOrigins({
      origins: origins.map((o: string) => o.toUpperCase()),
      destination,
      dateFrom,
      dateTo,
    });
    return {
      ok: true,
      action: "compare_origins",
      origins: origins.map((o: string) => o.toUpperCase()),
      destination: destination.toUpperCase(),
      window,
      count: rows.length,
      rows,
    };
  },
});
