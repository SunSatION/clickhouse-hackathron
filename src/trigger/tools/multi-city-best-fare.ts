import { z } from "zod";
import { defineTool } from "./registry.js";
import { findMultiCityBestFare } from "../../db/multi-city-best-fare.js";
import { getAirport } from "../../db/airports.js";

const StopSchema = z.object({
  iata: z.string().length(3).describe("Stop airport IATA."),
  minStayDays: z.number().int().min(1).max(30).optional().describe("Minimum days to spend at this stop (inclusive). Default: defaultStayDays - defaultFlexDays."),
  maxStayDays: z.number().int().min(1).max(30).optional().describe("Maximum days to spend at this stop (inclusive). Default: defaultStayDays + defaultFlexDays."),
});

const AnchorSchema = z.object({
  city: z.string().length(3).describe("IATA the traveller must be in on `day`."),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("ISO date YYYY-MM-DD inside the trip window."),
}).nullable().optional();

export const ToolMultiCityBestFare = defineTool({
  id: "tool-multi-city-best-fare",
  name: "multi_city_best_fare",
  description:
    "Anchor- and stay-constrained multi-city best-fare finder. Pass an ordered list of intermediate stops (the trip always starts and ends at `homeIata`), a date window, and per-stop stay config (min/max days). Global defaults `defaultStayDays` and `defaultFlexDays` apply to any stop that doesn't override. The planner builds one SQL statement with inline leg subqueries and a JOIN chain that enforces each stop's stay. Returns bundles ranked by total price.",
  schema: z.object({
    homeIata: z.string().length(3).describe("Trip origin/return IATA (e.g. 'STN', 'MLA'). The trip always starts and ends here."),
    stops: z.array(StopSchema).min(1).max(6).describe("Ordered intermediate stops (e.g. [{iata:'BCN',minStayDays:2,maxStayDays:4},{iata:'LIS',minStayDays:2,maxStayDays:6}] for 3 days ±1 in Barcelona and 4 days ±2 in Lisbon)."),
    dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Earliest trip start YYYY-MM-DD."),
    dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Latest return-home YYYY-MM-DD."),
    defaultStayDays: z.number().int().min(1).max(30).optional().describe("Default stay length per stop when not overridden (default 3)."),
    defaultFlexDays: z.number().int().min(0).max(7).optional().describe("Default ±flex per stop when not overridden (default 1 → 3 days ±1 = 2..4 days)."),
    legFlexDays: z.number().int().min(0).max(7).optional().describe("Per-leg ±flex around the cumulative target day (default 2)."),
    maxTotalPrice: z.number().int().min(0).optional().describe("Cap on the sum of all leg prices (0 = no cap)."),
    maxLegPrice: z.number().int().min(0).optional().describe("Cap on any single leg's price (0 = no cap)."),
    anchor: AnchorSchema,
    limit: z.number().int().min(1).max(100).optional().describe("Top-K bundles (default 20)."),
  }),
  handler: async ({ homeIata, stops, dateFrom, dateTo, defaultStayDays, defaultFlexDays, legFlexDays, maxTotalPrice, maxLegPrice, anchor, limit }) => {
    const result = await findMultiCityBestFare({
      homeIata: homeIata.toUpperCase(),
      stops: stops.map((s: { iata: string; minStayDays?: number; maxStayDays?: number }) => ({
        iata: s.iata.toUpperCase(),
        minStayDays: s.minStayDays,
        maxStayDays: s.maxStayDays,
      })),
      dateFrom,
      dateTo,
      defaultStayDays,
      defaultFlexDays,
      legFlexDays,
      maxTotalPrice,
      maxLegPrice,
      anchor: anchor
        ? { city: anchor.city.toUpperCase(), day: anchor.day }
        : null,
      limit,
    });
    const enriched = await Promise.all(
      result.bundles.map(async (b) => ({
        ...b,
        legs: await Promise.all(
          b.legs.map(async (l) => ({
            ...l,
            originAirport: await getAirport(l.from),
            destinationAirport: await getAirport(l.to),
          })),
        ),
      })),
    );
    return {
      ok: true,
      count: enriched.length,
      bundles: enriched,
      query: result.query,
      window: result.window,
      generatedSql: result.generatedSql,
    };
  },
});
