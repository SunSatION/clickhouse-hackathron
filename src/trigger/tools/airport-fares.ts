import { z } from "zod";
import { defineTool } from "./registry.js";
import { getAirport, listFaresForAirport } from '../../db/airports.js';

export const ToolAirportFares = defineTool({
  id: "tool-airport-fares",
  name: "get_airport_fares",
  description:
    "List fares originating from or arriving at an airport. Use this to inspect what's currently available before planning a trip.",
  schema: z.object({
    iata: z.string().length(3).describe("3-letter IATA airport code."),
    dateFrom: z.string().optional().describe("Filter by departure date >= YYYY-MM-DD."),
    dateTo: z.string().optional().describe("Filter by departure date <= YYYY-MM-DD."),
    limit: z.number().int().min(1).max(500).optional().describe("Max results (default 200)."),
  }),
  handler: async ({ iata, dateFrom, dateTo, limit }) => {
    const fares = await listFaresForAirport({
      iata,
      dateFrom,
      dateTo,
      limit: limit ?? 200,
    });
    const airport = await getAirport(iata);
    return { ok: true, iata, airport, count: fares.length, fares };
  },
});
