import { z } from "zod";
import { defineTool } from "./registry.js";
import { findCheapestFromAnyOrigin } from '../../db/fare-finder.js';

export const ToolCheapestFromAny = defineTool({
  id: "tool-cheapest-from-any",
  name: "find_cheapest_from_any_origin",
  description:
    "Compare multiple origin airports (e.g. all London airports) to find the single cheapest combination to each destination. Returns ranked destinations with the best origin and a sorted list of alternatives.",
  schema: z.object({
    origins: z.array(z.string().length(3)).min(1).max(8).describe("Origin IATAs (e.g. ['STN','LGW','LTN'])."),
    destination: z.string().length(3).optional().describe("Optional specific destination filter."),
    dateFrom: z.string(),
    dateTo: z.string(),
    limit: z.number().int().min(1).max(50).optional().describe("Default 10 destinations."),
  }),
  handler: async ({ origins, destination, dateFrom, dateTo, limit }) => {
    const deals = await findCheapestFromAnyOrigin({ origins, destination, dateFrom, dateTo, limit });
    return {
      ok: true,
      origins: origins.map((o: string) => o.toUpperCase()),
      window: { dateFrom, dateTo },
      count: deals.length,
      destinations: deals,
    };
  },
});
