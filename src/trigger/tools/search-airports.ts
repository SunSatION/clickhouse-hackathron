import { z } from "zod";
import { defineTool } from "./registry";
import { listAirportsForAirline, searchAirports } from '../../db/airports';

export const ToolSearchAirports = defineTool({
  id: "tool-search-airports",
  name: "search_airports",
  description:
    "Look up airports by IATA code, city name, or country code. Returns at most 25 airports with their IATA, city, country, and lat/lon.",
  schema: z.object({
    query: z.string().min(1).describe("Free-text query: IATA code, city name, or ISO country code."),
    airline: z.string().optional().describe("Restrict to airports reachable by this airline (default Ryanair)."),
  }),
  handler: async ({ query, airline }) => {
    const local = searchAirports(query, 25);
    if (local.length > 0) return { ok: true, count: local.length, airports: local };
    if (airline) {
      const rows = await listAirportsForAirline(airline);
      const q = query.toLowerCase();
      const filtered = rows.filter(
        (a) => a.iata.toLowerCase().includes(q) || (a.city || "").toLowerCase().includes(q) || (a.country || "").toLowerCase() === q,
      );
      return { ok: true, count: filtered.length, airports: filtered.slice(0, 25) };
    }
    return { ok: true, count: 0, airports: [] };
  },
});
