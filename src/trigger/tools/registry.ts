import { z } from "zod";

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

export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
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

export function defineTool(def: {
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

import { ToolSearchAirports } from "./search-airports.js";
import { ToolSelectOrigin } from "./select-origin.js";
import { ToolDrawDestinationArrows } from "./draw-destination-arrows.js";
import { ToolFindFastest } from "./find-fastest.js";
import { ToolCompareOrigins } from "./compare-origins.js";
import { ToolAirportFares } from "./airport-fares.js";
import { ToolRoundTrip } from "./plan-round-trip.js";
import { ToolMultiStop } from "./plan-multi-stop.js";
import { ToolRefreshCrawl } from "./trigger-refresh-crawl.js";
import { ToolCheapestDestinations } from "./find-cheapest-destinations.js";
import { ToolCheapestDates } from "./find-cheapest-dates.js";
import { ToolBestRoundTrip } from "./find-best-round-trip.js";
import { ToolBestOneWay } from "./find-best-one-way.js";
import { ToolCheapestFromAny } from "./find-cheapest-from-any-origin.js";
import { ToolWeekendDeals } from "./find-weekend-deals.js";

import { ToolListFavorites } from "./list-favorites.js";
import { ToolSaveFavorite } from "./save-favorite.js";
import { ToolRemoveFavorite } from "./remove-favorite.js";
import { ToolGetHomeAirport } from "./get-home-airport.js";

export {
  ToolSearchAirports,
  ToolSelectOrigin,
  ToolDrawDestinationArrows,
  ToolFindFastest,
  ToolCompareOrigins,
  ToolAirportFares,
  ToolRoundTrip,
  ToolMultiStop,
  ToolRefreshCrawl,
  ToolCheapestDestinations,
  ToolCheapestDates,
  ToolBestRoundTrip,
  ToolBestOneWay,
  ToolCheapestFromAny,
  ToolWeekendDeals,
  ToolListFavorites,
  ToolSaveFavorite,
  ToolRemoveFavorite,
  ToolGetHomeAirport,
};

const ALL_TOOLS = [
  ToolSearchAirports,
  ToolSelectOrigin,
  ToolDrawDestinationArrows,
  ToolFindFastest,
  ToolCompareOrigins,
  ToolAirportFares,
  ToolCheapestDestinations,
  ToolCheapestDates,
  ToolBestOneWay,
  ToolBestRoundTrip,
  ToolCheapestFromAny,
  ToolWeekendDeals,
  ToolRoundTrip,
  ToolMultiStop,
  ToolRefreshCrawl,
  ToolListFavorites,
  ToolSaveFavorite,
  ToolRemoveFavorite,
  ToolGetHomeAirport,
];

export function listTools(): ToolDefinition[] {
  return ALL_TOOLS;
}

export function getTool(id: string): ToolDefinition | null {
  return ALL_TOOLS.find((t) => t.id === id) ?? null;
}

export function getToolByName(name: string): ToolDefinition | null {
  return ALL_TOOLS.find((t) => t.name === name) ?? null;
}

export type { CheapestRoute, RoundTrip } from "../../db/airports.js";
