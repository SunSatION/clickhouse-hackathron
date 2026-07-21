import { z } from "zod";
import { defineTool } from "./registry.js";
import { findBestOneWay } from '../../db/fare-finder.js';

export const ToolBestOneWay = defineTool({
  id: "tool-best-one-way",
  name: "find_best_one_way",
  description:
    "K cheapest one-way fares for a route, one per date, sorted by price ascending. Useful when a user wants the absolute lowest ticket regardless of dates.",
  schema: z.object({
    origin: z.string().length(3),
    destination: z.string().length(3),
    dateFrom: z.string(),
    dateTo: z.string(),
    airlineCode: z.string().optional(),
    limit: z.number().int().min(1).max(60).optional().describe("Default 10."),
  }),
  handler: async ({ origin, destination, dateFrom, dateTo, airlineCode, limit }) => {
    const rows = await findBestOneWay({ origin, destination, dateFrom, dateTo, airlineCode, limit });
    return {
      ok: true,
      origin: origin.toUpperCase(),
      destination: destination.toUpperCase(),
      count: rows.length,
      fares: rows,
    };
  },
});
