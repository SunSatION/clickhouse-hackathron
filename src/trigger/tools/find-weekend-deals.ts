import { z } from "zod";
import { defineTool } from "./registry";
import { findWeekendDeals } from '../../db/fare-finder';

export const ToolWeekendDeals = defineTool({
  id: "tool-weekend-deals",
  name: "find_weekend_deals",
  description:
    "Weekend-trip preset: bundles round trips that depart Fri–Sun and return Fri–Sun within a N±2 day window, ranked by total. Built for natural language 'I want a cheap weekend in BCN'.",
  schema: z.object({
    origin: z.string().length(3),
    destination: z.string().length(3),
    dateFrom: z.string(),
    dateTo: z.string(),
    nightCount: z.number().int().min(1).max(21).optional().describe("Number of nights (default 4)."),
    airlineCode: z.string().optional(),
    limit: z.number().int().min(1).max(20).optional().describe("Top-K bundles (default 5)."),
  }),
  handler: async ({ origin, destination, dateFrom, dateTo, nightCount, airlineCode, limit }) => {
    const bundles = await findWeekendDeals({ origin, destination, dateFrom, dateTo, nightCount, airlineCode, limit });
    return {
      ok: true,
      origin: origin.toUpperCase(),
      destination: destination.toUpperCase(),
      window: { dateFrom, dateTo, nights: nightCount ?? 4 },
      count: bundles.length,
      options: bundles,
    };
  },
});
