import { z } from "zod";
import { defineTool } from "./registry.js";
import { findCheapestDestinations } from '../../db/fare-finder.js';

export const ToolDrawDestinationArrows = defineTool({
  id: "tool-draw-destination-arrows",
  name: "draw_destination_arrows",
  description:
    "List all destinations reachable from an origin, including price + flight duration per destination. The UI will draw polylines (arrows) from the origin to each destination, with mid-line tooltips showing price and duration. Use this when the user asks for 'destination airports from X' or wants to see all reachable destinations with metadata, not just the cheapest N.",
  schema: z.object({
    origin: z.string().length(3).describe("Origin IATA code."),
    dateFrom: z.string().describe("Earliest departure date YYYY-MM-DD."),
    dateTo: z.string().describe("Latest departure date YYYY-MM-DD."),
    maxPrice: z.number().optional().describe("Drop fares above this EUR-equivalent price."),
    limit: z.number().int().min(1).max(80).optional().describe("Max destinations to draw (default 30)."),
  }),
  handler: async ({ origin, dateFrom, dateTo, maxPrice, limit }) => {
    const deals = await findCheapestDestinations({
      origin,
      dateFrom,
      dateTo,
      maxPrice,
      limit: limit ?? 30,
    });
    return {
      ok: true,
      action: "draw_destination_arrows",
      origin: origin.toUpperCase(),
      window: { dateFrom, dateTo },
      count: deals.length,
      destinations: deals,
    };
  },
});
