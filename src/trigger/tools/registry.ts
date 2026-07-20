import { z } from "zod";

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
    "Plan a multi-stop round trip starting and ending at `homeIata`, visiting each destination in order. Returns up to 8 permutations sorted by price.",
  schema: z.object({
    homeIata: z.string().length(3).describe("Home airport IATA code."),
    destinations: z.array(z.string().length(3)).min(1).max(6).describe("1-6 destination IATA codes."),
    dateFrom: z.string().describe("Trip start date YYYY-MM-DD."),
    dateTo: z.string().describe("Trip end date YYYY-MM-DD."),
    daysPerCountry: z.number().int().min(1).max(30).optional().describe("Days spent at each stop."),
    maxItineraries: z.number().int().min(1).max(8).optional(),
  }),
  handler: async ({ homeIata, destinations, dateFrom, dateTo, daysPerCountry, maxItineraries }) => {
    const itineraries = await generateItineraries({
      homeIata,
      destinations,
      dateFrom,
      dateTo,
      daysPerCountry: daysPerCountry ?? 3,
      maxItineraries: maxItineraries ?? 4,
    });
    const enriched = itineraries.map((it) => ({
      ...it,
      legs: it.legs.map((leg) => ({
        ...leg,
        originAirport: getAirport(leg.origin),
        destinationAirport: getAirport(leg.destination),
      })),
    }));
    return { ok: true, count: enriched.length, itineraries: enriched };
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
    return {
      ok: true,
      crawlRunId,
      airline: a,
      enqueued: enqueue.enqueued,
      alreadyPending: enqueue.already_pending,
      legsQueued: legs.length,
      legs,
    };
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