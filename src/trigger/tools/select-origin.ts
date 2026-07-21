import { z } from "zod";
import { defineTool } from "./registry.js";
import { getAirport, listFaresForAirport } from '../../db/airports.js';

export const ToolSelectOrigin = defineTool({
  id: "tool-select-origin",
  name: "select_origin_on_map",
  description:
    "Select an airport as the map origin (mirrors clicking its pin on the map). The UI will dim non-connected airports and highlight destinations reachable from this origin. Use this whenever the user names a single airport as the starting point of a query, e.g. 'show me flights from TPS'.",
  schema: z.object({
    iata: z.string().length(3).describe("3-letter IATA airport code to set as origin."),
  }),
  handler: async ({ iata }) => {
    const code = iata.toUpperCase();
    const airport = getAirport(code);
    if (!airport) return { ok: false, error: `unknown IATA: ${code}` };
    const fares = await listFaresForAirport({ iata: code, limit: 500 });
    const destinations = new Set<string>();
    for (const f of fares) {
      if (f.origin === code) destinations.add(f.destination);
      else destinations.add(f.origin);
    }
    return {
      ok: true,
      action: "select_origin",
      iata: code,
      airport,
      destinations: Array.from(destinations),
    };
  },
});
