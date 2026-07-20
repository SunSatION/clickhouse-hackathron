import { z } from "zod";

import { tasks } from "@trigger.dev/sdk";

import {
  listAirportsForAirline,
  searchAirports,
  listFaresForAirport,
  findCheapestRoundTrip,
  getAirport,
  type CheapestRoute,
  type RoundTrip,
} from "../../db/airports";
import { generateItineraries, listFavorites, saveFavorite, removeFavorite } from "../../db/itinerary";
import { enqueuePendingRoutes } from "../../db/crawl-progress";
import { CRAWL_CONFIG } from "../../config/crawl";
import {
  findBestRoundTrip,
  findBestOneWay,
  findCheapestDates,
  findCheapestDestinations,
  findCheapestFromAnyOrigin,
  findWeekendDeals,
  getDatasetFreshness,
  buildToolHints,
} from "../../db/fare-finder";
import { planBestItinerary } from "../../db/itinerary-planner";

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  parameters: Record<string, unknown>;
  handler: (params: unknown) => Promise<unknown>;
}

function describeField(field: z.ZodTypeAny): Record<string, unknown> {
  const description = (field as unknown as { description?: string }).description;
  return description ? { description } : {};
}

function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = { ...describeField(value), ...describePrimitive(value) };
      if (!(value instanceof z.ZodOptional) && !(value instanceof z.ZodDefault)) required.push(key);
    }
    return { type: "object", properties, required };
  }
  return { type: "object", properties: {}, required: [] };
}

function describePrimitive(schema: z.ZodTypeAny): Record<string, unknown> {
  let inner: z.ZodTypeAny = schema;
  while (inner instanceof z.ZodOptional || inner instanceof z.ZodDefault) {
    inner = (inner as unknown as { _def: { innerType: z.ZodTypeAny } })._def.innerType;
  }
  if (inner instanceof z.ZodString) return { type: "string" };
  if (inner instanceof z.ZodNumber) return { type: "number" };
  if (inner instanceof z.ZodBoolean) return { type: "boolean" };
  if (inner instanceof z.ZodArray) {
    return { type: "array", items: describePrimitive((inner as unknown as { _def: { type: z.ZodTypeAny } })._def.type) };
  }
  if (inner instanceof z.ZodEnum) {
    return { type: "string", enum: (inner as unknown as { _def: { values: string[] } })._def.values };
  }
  if (inner instanceof z.ZodObject) return zodToJsonSchema(inner);
  return {};
}

function defineTool(def: {
  id: string;
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  handler: (params: any) => Promise<unknown>;
}): ToolDefinition {
  const parameters = zodToJsonSchema(def.schema);
  return {
    id: def.id,
    name: def.name,
    description: def.description,
    schema: def.schema,
    parameters,
    handler: def.handler as (params: unknown) => Promise<unknown>,
  };
}

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
    const airport = getAirport(iata);
    return { ok: true, iata, airport, count: fares.length, fares };
  },
});

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
    const trips = await findCheapestRoundTrip({
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
    };
  },
});

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

export const ToolRefreshCrawl = defineTool({
  id: "tool-refresh-crawl",
  name: "trigger_refresh_crawl",
  description:
    "Queue a fresh crawl for one or more flight legs that are missing price data. Runs the crawl-queue-worker.",
  schema: z.object({
    legs: z
      .array(
        z.object({
          origin: z.string().length(3),
          destination: z.string().length(3),
          dateFrom: z.string().describe("YYYY-MM-DD"),
          dateTo: z.string().describe("YYYY-MM-DD"),
        }),
      )
      .min(1)
      .max(50),
    airline: z.enum(["Ryanair", "EasyJet"]).optional(),
    runId: z.string().optional(),
  }),
  handler: async ({ legs, airline, runId }: { legs: Array<{ origin: string; destination: string; dateFrom: string; dateTo: string }>; airline?: "Ryanair" | "EasyJet"; runId?: string }) => {
    const a = airline ?? "Ryanair";
    const crawlRunId = runId ?? crypto.randomUUID();
    const origins = Array.from(new Set(legs.map((l: { origin: string }) => l.origin)));
    const first = legs[0];
    if (!first) throw new Error("legs must not be empty");
    const enqueue = await enqueuePendingRoutes({
      airline: a,
      origins,
      dateFrom: first.dateFrom,
      dateTo: first.dateTo,
      crawlRunId,
    });

    const handle = await tasks.trigger<
      typeof import("../../trigger/crawl-queue-worker").crawlQueueWorker
    >("crawl-queue-worker", {
      airline: a,
      crawlRunId,
      maxIterations: Math.max(enqueue.enqueued + enqueue.already_pending, 1),
      adults: CRAWL_CONFIG[a.toLowerCase() as "ryanair" | "easyjet"]?.adults ?? 1,
      requestDelayMs: CRAWL_CONFIG[a.toLowerCase() as "ryanair" | "easyjet"]?.requestDelayMs ?? 0,
      requestJitterMs: CRAWL_CONFIG[a.toLowerCase() as "ryanair" | "easyjet"]?.requestJitterMs ?? 0,
      cooldownMs: CRAWL_CONFIG[a.toLowerCase() as "ryanair" | "easyjet"]?.cooldownMs ?? 0,
    });

    return {
      ok: true,
      crawlRunId,
      airline: a,
      runId: handle.id,
      task: "crawl-queue-worker",
      publicAccessToken: handle.publicAccessToken,
      enqueued: enqueue.enqueued,
      alreadyPending: enqueue.already_pending,
      legsQueued: legs.length,
      legs,
    };
  },
});

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
    const cells = await findCheapestDates({ origin, destination, dateFrom, dateTo, airlineCode, limit });
    return {
      ok: true,
      origin: origin.toUpperCase(),
      destination: destination.toUpperCase(),
      window: { dateFrom, dateTo },
      count: cells.length,
      cells,
    };
  },
});

export const ToolBestRoundTrip = defineTool({
  id: "tool-best-round-trip",
  name: "find_best_round_trip",
  description:
    "Bundle search: joins the cheapest outbound and return legs into priced round-trip bundles ranked by total price, respecting min/max trip length. Replaces the older TS-based pairing logic with a single ClickHouse self-join — answers 'cheapest round trip A↔B for a N-day holiday'.",
  schema: z.object({
    origin: z.string().length(3),
    destination: z.string().length(3),
    dateFrom: z.string(),
    dateTo: z.string(),
    minDays: z.number().int().min(1).max(60).optional().describe("Min trip length in days (default 3)."),
    maxDays: z.number().int().min(1).max(60).optional().describe("Max trip length in days (default 14)."),
    airlineCode: z.string().optional(),
    limit: z.number().int().min(1).max(50).optional().describe("Top-K bundles (default 5)."),
  }),
  handler: async ({ origin, destination, dateFrom, dateTo, minDays, maxDays, airlineCode, limit }) => {
    const bundles = await findBestRoundTrip({ origin, destination, dateFrom, dateTo, minDays, maxDays, airlineCode, limit });
    return {
      ok: true,
      origin: origin.toUpperCase(),
      destination: destination.toUpperCase(),
      window: { dateFrom, dateTo, minDays: minDays ?? 3, maxDays: maxDays ?? 14 },
      count: bundles.length,
      options: bundles,
    };
  },
});

export const ToolBestOneWay = defineTool({
  id: "tool-best-one-way",
  name: "find_best_one_way",
  description:
    "K cheapest one-way fares for a route, one per date, sorted by price ascending. Useful when a user wants the absolute lowest ticket regardless of dates.",
  schema: z.object({
    origin: z.string().length(3),
    destination: z.string().length(3),
    dateFrom: z.string(),
    dateTo: z.string(),
    airlineCode: z.string().optional(),
    limit: z.number().int().min(1).max(60).optional().describe("Default 10."),
  }),
  handler: async ({ origin, destination, dateFrom, dateTo, airlineCode, limit }) => {
    const rows = await findBestOneWay({ origin, destination, dateFrom, dateTo, airlineCode, limit });
    return {
      ok: true,
      origin: origin.toUpperCase(),
      destination: destination.toUpperCase(),
      count: rows.length,
      fares: rows,
    };
  },
});

export const ToolCheapestFromAny = defineTool({
  id: "tool-cheapest-from-any",
  name: "find_cheapest_from_any_origin",
  description:
    "Compare multiple origin airports (e.g. all London airports) to find the single cheapest combination to each destination. Returns ranked destinations with the best origin and a sorted list of alternatives.",
  schema: z.object({
    origins: z.array(z.string().length(3)).min(1).max(8).describe("Origin IATAs (e.g. ['STN','LGW','LTN'])."),
    destination: z.string().length(3).optional().describe("Optional specific destination filter."),
    dateFrom: z.string(),
    dateTo: z.string(),
    limit: z.number().int().min(1).max(50).optional().describe("Default 10 destinations."),
  }),
  handler: async ({ origins, destination, dateFrom, dateTo, limit }) => {
    const deals = await findCheapestFromAnyOrigin({ origins, destination, dateFrom, dateTo, limit });
    return {
      ok: true,
      origins: origins.map((o: string) => o.toUpperCase()),
      window: { dateFrom, dateTo },
      count: deals.length,
      destinations: deals,
    };
  },
});

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

export const ToolDatasetFreshness = defineTool({
  id: "tool-dataset-freshness",
  name: "get_dataset_freshness",
  description:
    "Returns how fresh the flight_listings data is (max observed_at per airline + per route) plus row counts. Use this BEFORE quoting prices so the LLM can warn the user if data is stale or sparse.",
  schema: z.object({}),
  handler: async () => {
    const f = await getDatasetFreshness();
    return { ok: true, freshness: f, hints: buildToolHints(f) };
  },
});

export const ToolListFavorites = defineTool({
  id: "tool-list-favorites",
  name: "list_favorites",
  description: "List the user's saved trip itineraries.",
  schema: z.object({}),
  handler: async () => ({ ok: true, count: listFavorites().length, favorites: listFavorites() }),
});

export const ToolSaveFavorite = defineTool({
  id: "tool-save-favorite",
  name: "save_favorite",
  description: "Persist an itinerary (with its legs, price, currency) to the user's favorites.",
  schema: z.object({
    itinerary: z.object({
      id: z.string(),
      title: z.string(),
      totalPrice: z.number(),
      currency: z.string(),
      legs: z.array(z.object({
        origin: z.string(),
        destination: z.string(),
        date: z.string().optional(),
        price: z.number(),
        currency: z.string(),
        airline: z.string().optional(),
      })),
    }),
  }),
  handler: async ({ itinerary }) => {
    const fav = saveFavorite(itinerary as never);
    return { ok: true, favorite: fav };
  },
});

export const ToolRemoveFavorite = defineTool({
  id: "tool-remove-favorite",
  name: "remove_favorite",
  description: "Remove a saved favorite by its favorite id.",
  schema: z.object({ favoriteId: z.string().uuid() }),
  handler: async ({ favoriteId }) => ({ ok: removeFavorite(favoriteId) }),
});

const ALL_TOOLS = [
  ToolSearchAirports,
  ToolAirportFares,
  ToolCheapestDestinations,
  ToolCheapestDates,
  ToolBestOneWay,
  ToolBestRoundTrip,
  ToolCheapestFromAny,
  ToolWeekendDeals,
  ToolDatasetFreshness,
  ToolRoundTrip,
  ToolMultiStop,
  ToolRefreshCrawl,
  ToolListFavorites,
  ToolSaveFavorite,
  ToolRemoveFavorite,
];

export function listTools(): ToolDefinition[] {
  return ALL_TOOLS;
}

export function getTool(id: string): ToolDefinition | null {
  return ALL_TOOLS.find((t) => t.id === id) ?? null;
}

export type { CheapestRoute, RoundTrip };