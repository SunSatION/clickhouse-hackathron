import { z } from "zod";
import { defineTool } from "./registry";
import { findCheapestDestinations } from '../../db/fare-finder';

export const ToolCheapestDestinations = defineTool({
  id: "tool-cheapest-destinations",
  name: "find_cheapest_destinations",
  description:
    "Inspiration search: returns the N cheapest destinations reachable from a given origin within a date range, ranked by best price. Use this when the user has not picked a destination yet ('where can I fly cheaply from MLA in September?').",
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
    const deals = await findCheapestDestinations({ origin, dateFrom, dateTo, airline, airlineCode, maxPrice, limit });
    return {
      ok: true,
      origin: origin.toUpperCase(),
      window: { dateFrom, dateTo },
      count: deals.length,
      destinations: deals,
    };
  },
});
