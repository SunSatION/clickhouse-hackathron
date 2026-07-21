import { z } from "zod";
import { defineTool } from "./registry";
import { planBestItinerary } from '../../db/itinerary-planner';
import { getAirport } from '../../db/airports';

export const ToolMultiStop = defineTool({
  id: "tool-multi-stop",
  name: "plan_multi_stop",
  description:
    "Plan a multi-stop round trip starting and ending at `homeIata`, visiting each destination in order. Returns up to 8 permutations sorted by price. Backed by a single-click ClickHouse planner (not the legacy in-memory loop).",
  schema: z.object({
    homeIata: z.string().length(3).describe("Home airport IATA code."),
    destinations: z.array(z.string().length(3)).min(1).max(6).describe("1-6 destination IATA codes."),
    dateFrom: z.string().describe("Trip start date YYYY-MM-DD."),
    dateTo: z.string().describe("Trip end date YYYY-MM-DD."),
    daysPerCountry: z.number().int().min(1).max(30).optional().describe("Days spent at each stop."),
    maxItineraries: z.number().int().min(1).max(8).optional().describe("Top-K itineraries to return (default 4)."),
    bufferDays: z.number().int().min(0).max(7).optional().describe("Layover buffer days (default 1)."),
    preferredAirlines: z.array(z.string()).max(6).optional().describe("Restrict to airline codes (e.g. ['FR','EZY'])."),
  }),
  handler: async ({ homeIata, destinations, dateFrom, dateTo, daysPerCountry, maxItineraries, bufferDays, preferredAirlines }) => {
    const result = await planBestItinerary({
      home: homeIata.toUpperCase(),
      stops: destinations.map((d: string) => d.toUpperCase()),
      dateFrom,
      dateTo,
      bufferDays: bufferDays ?? 1,
      topK: maxItineraries ?? 4,
      preferredAirlines,
    });
    const legsFlat = result.flatMap((itin) => itin.legs);
    return {
      ok: true,
      count: result.length,
      itineraries: result.map((it) => ({
        ...it,
        legs: it.legs.map((leg) => ({
          ...leg,
          originAirport: getAirport(leg.origin),
          destinationAirport: getAirport(leg.destination),
        })),
      })),
      coverage: {
        legs: legsFlat.length,
      },
    };
  },
});
