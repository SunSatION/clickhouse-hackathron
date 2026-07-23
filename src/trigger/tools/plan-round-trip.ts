import { z } from "zod";
import { defineTool } from "./registry.js";
import { findCheapestRoundTrip } from '../../db/airports.js';

export const ToolRoundTrip = defineTool({
  id: "tool-round-trip",
  name: "plan_round_trip",
  description:
    "Find the cheapest round trip between an origin and a single destination. Optionally constrain the trip length in days.",
  schema: z.object({
    origin: z.string().length(3).describe("Origin IATA code."),
    destination: z.string().length(3).describe("Destination IATA code."),
    dateFrom: z.string().describe("Earliest outbound date YYYY-MM-DD."),
    dateTo: z.string().describe("Latest return date YYYY-MM-DD."),
    minDays: z.number().int().min(1).max(60).optional().describe("Minimum trip length in days."),
    maxDays: z.number().int().min(1).max(60).optional().describe("Maximum trip length in days."),
    limit: z.number().int().min(1).max(20).optional().describe("Max round-trip options to return (default 5)."),
  }),
  handler: async ({ origin, destination, dateFrom, dateTo, minDays, maxDays, limit }) => {
    const { trips, window } = await findCheapestRoundTrip({
      origin,
      destination,
      dateFrom,
      dateTo,
      minDays,
      maxDays,
    });
    return {
      ok: true,
      origin: origin.toUpperCase(),
      destination: destination.toUpperCase(),
      count: trips.length,
      options: trips.slice(0, limit ?? 5),
      window,
    };
  },
});
