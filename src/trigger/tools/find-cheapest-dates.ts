import { z } from "zod";
import { defineTool } from "./registry.js";
import { findCheapestDates } from '../../db/fare-finder.js';

export const ToolCheapestDates = defineTool({
  id: "tool-cheapest-dates",
  name: "find_cheapest_dates",
  description:
    "Calendar view: returns the cheapest one-way price per date for a fixed origin→destination pair across a date window. Use this when the user is open to travel dates and wants a heatmap ('when is the cheapest day to fly MLA→BCN this month?').",
  schema: z.object({
    origin: z.string().length(3),
    destination: z.string().length(3),
    dateFrom: z.string(),
    dateTo: z.string(),
    airlineCode: z.string().optional(),
    limit: z.number().int().min(1).max(120).optional().describe("Cap rows (default 60)."),
  }),
  handler: async ({ origin, destination, dateFrom, dateTo, airlineCode, limit }) => {
    const { results: cells, window } = await findCheapestDates({ origin, destination, dateFrom, dateTo, airlineCode, limit });
    return {
      ok: true,
      origin: origin.toUpperCase(),
      destination: destination.toUpperCase(),
      window,
      count: cells.length,
      cells,
    };
  },
});
