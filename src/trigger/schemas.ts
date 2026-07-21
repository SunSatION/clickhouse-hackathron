import { z } from "zod";

import { CRAWL_CONFIG } from "../config/index.js";

export const IATA = z.string().length(3).regex(/^[A-Z]{3}$/);
export const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const RequestDelayMs = z.number().int().min(0).max(60_000);
export const RequestJitterMs = z.number().int().min(0).max(30_000);

export const RyanairRoutePayload = z.object({
  crawlRunId: z.string().uuid(),
  originIata: IATA,
  dateFrom: DateStr,
  dateTo: DateStr,
  destinationFilter: z.array(IATA).optional(),
  adults: z.number().int().min(1).max(9).default(CRAWL_CONFIG.ryanair.adults),
  requestDelayMs: RequestDelayMs.default(CRAWL_CONFIG.ryanair.requestDelayMs),
  requestJitterMs: RequestJitterMs.default(CRAWL_CONFIG.ryanair.requestJitterMs),
  cooldownMs: z.number().int().min(0).max(60 * 60 * 24 * 1000).default(CRAWL_CONFIG.ryanair.cooldownMs),
});

export type RyanairRoutePayloadT = z.infer<typeof RyanairRoutePayload>;

export const RyanairRouteOutput = z.object({
  originIata: z.string(),
  dateFrom: DateStr,
  dateTo: DateStr,
  destinationsScanned: z.number().int(),
  rowsInserted: z.number().int(),
  requestsMade: z.number().int(),
  cacheHits: z.number().int(),
  requestsSkipped: z.number().int(),
  errors: z.array(
    z.object({ origin: z.string(), date: z.string(), message: z.string() })
  ),
  durationMs: z.number().int(),
});

export type RyanairRouteOutputT = z.infer<typeof RyanairRouteOutput>;

export type RyanairRouteInput = {
  crawlRunId: string;
  originIata: string;
  dateFrom: string;
  dateTo: string;
  destinationFilter?: string[];
  adults?: number;
  requestDelayMs?: number;
  requestJitterMs?: number;
  cooldownMs?: number;
};

export const RyanairFanOutPayload = z.object({
  crawlRunId: z.string().uuid(),
  origins: z.array(IATA).min(1),
  destinationFilter: z.array(IATA).optional(),
  dateFrom: DateStr,
  dateTo: DateStr,
  adults: z.number().int().min(1).max(9).default(CRAWL_CONFIG.ryanair.adults),
  requestDelayMs: RequestDelayMs.default(CRAWL_CONFIG.ryanair.requestDelayMs),
  requestJitterMs: RequestJitterMs.default(CRAWL_CONFIG.ryanair.requestJitterMs),
  cooldownMs: z.number().int().min(0).max(60 * 60 * 24 * 1000).default(CRAWL_CONFIG.ryanair.cooldownMs),
});

export type RyanairFanOutInput = {
  crawlRunId: string;
  origins: string[];
  destinationFilter?: string[];
  dateFrom: string;
  dateTo: string;
  adults?: number;
  requestDelayMs?: number;
  requestJitterMs?: number;
  cooldownMs?: number;
};

export const RyanairFanOutOutput = z.object({
  crawlRunId: z.string().uuid(),
  originsScanned: z.number().int(),
  rowsInserted: z.number().int(),
  requestsMade: z.number().int(),
  cacheHits: z.number().int(),
  requestsSkipped: z.number().int(),
  errors: z.array(
    z.object({ origin: z.string(), date: z.string(), message: z.string() })
  ),
  durationMs: z.number().int(),
});

export type RyanairFanOutOutputT = z.infer<typeof RyanairFanOutOutput>;

export const AirlineCodeSchema = z.enum(["FR", "U2"]);
export type AirlineCodeT = z.infer<typeof AirlineCodeSchema>;

export const AirlineOriginsByCode = z.record(
  z.string(),
  z.array(IATA).min(1)
);

export const CrawlAirlinesPayload = z.object({
  crawlRunId: z.string().uuid(),
  airlines: z.array(AirlineCodeSchema).min(1),
  origins: AirlineOriginsByCode,
  destinationFilter: z.array(IATA).optional(),
  dateFrom: DateStr,
  dateTo: DateStr,
  adults: z.number().int().min(1).max(9).default(CRAWL_CONFIG.ryanair.adults),
  requestDelayMs: RequestDelayMs.default(CRAWL_CONFIG.ryanair.requestDelayMs),
  requestJitterMs: RequestJitterMs.default(CRAWL_CONFIG.ryanair.requestJitterMs),
  cooldownMs: z.number().int().min(0).max(60 * 60 * 24 * 1000).default(CRAWL_CONFIG.ryanair.cooldownMs),
});

export type CrawlAirlinesInput = {
  crawlRunId: string;
  airlines: AirlineCodeT[];
  origins: Partial<Record<AirlineCodeT, string[]>>;
  destinationFilter?: string[];
  dateFrom: string;
  dateTo: string;
  adults?: number;
  requestDelayMs?: number;
  requestJitterMs?: number;
  cooldownMs?: number;
};

export const CrawlAirlinesOutput = z.object({
  crawlRunId: z.string().uuid(),
  rowsInserted: z.number().int(),
  durationMs: z.number().int(),
  byAirline: z.record(
    z.object({
      rowsInserted: z.number().int(),
      errors: z.array(z.string()),
    })
  ),
});

export type CrawlAirlinesOutputT = z.infer<typeof CrawlAirlinesOutput>;

export const EasyJetRoutePayload = z.object({
  crawlRunId: z.string().uuid(),
  originIata: IATA,
  destinations: z.array(IATA).min(1),
  dateFrom: DateStr,
  dateTo: DateStr,
  currency: z.string().length(3).default("GBP"),
  adults: z.number().int().min(1).max(9).default(CRAWL_CONFIG.easyjet.adults),
  requestDelayMs: RequestDelayMs.default(CRAWL_CONFIG.easyjet.requestDelayMs),
  requestJitterMs: RequestJitterMs.default(CRAWL_CONFIG.easyjet.requestJitterMs),
  cooldownMs: z
    .number()
    .int()
    .min(0)
    .max(60 * 60 * 24 * 1000)
    .default(CRAWL_CONFIG.easyjet.cooldownMs),
});

export type EasyJetRoutePayloadT = z.infer<typeof EasyJetRoutePayload>;

export const EasyJetRouteOutput = z.object({
  originIata: z.string(),
  destinationsScanned: z.number().int(),
  rowsInserted: z.number().int(),
  requestsMade: z.number().int(),
  cacheHits: z.number().int(),
  requestsSkipped: z.number().int(),
  errors: z.array(
    z.object({ origin: z.string(), date: z.string(), message: z.string() })
  ),
  durationMs: z.number().int(),
});

export type EasyJetRouteOutputT = z.infer<typeof EasyJetRouteOutput>;

export type EasyJetRouteInput = {
  crawlRunId: string;
  originIata: string;
  destinations: string[];
  dateFrom: string;
  dateTo: string;
  currency?: string;
  adults?: number;
  requestDelayMs?: number;
  requestJitterMs?: number;
  cooldownMs?: number;
};

export const EasyJetFanOutPayload = z.object({
  crawlRunId: z.string().uuid(),
  origins: z.array(IATA).min(1),
  destinationFilter: z.array(IATA).optional(),
  dateFrom: DateStr,
  dateTo: DateStr,
  currency: z.string().length(3).default("GBP"),
  adults: z.number().int().min(1).max(9).default(CRAWL_CONFIG.easyjet.adults),
  requestDelayMs: RequestDelayMs.default(CRAWL_CONFIG.easyjet.requestDelayMs),
  requestJitterMs: RequestJitterMs.default(CRAWL_CONFIG.easyjet.requestJitterMs),
  cooldownMs: z
    .number()
    .int()
    .min(0)
    .max(60 * 60 * 24 * 1000)
    .default(CRAWL_CONFIG.easyjet.cooldownMs),
});

export type EasyJetFanOutInput = {
  crawlRunId: string;
  origins: string[];
  destinationFilter?: string[];
  dateFrom: string;
  dateTo: string;
  currency?: string;
  adults?: number;
  requestDelayMs?: number;
  requestJitterMs?: number;
  cooldownMs?: number;
};

export const EasyJetFanOutOutput = z.object({
  crawlRunId: z.string().uuid(),
  originsScanned: z.number().int(),
  rowsInserted: z.number().int(),
  requestsMade: z.number().int(),
  cacheHits: z.number().int(),
  requestsSkipped: z.number().int(),
  errors: z.array(
    z.object({ origin: z.string(), date: z.string(), message: z.string() })
  ),
  durationMs: z.number().int(),
});

export type EasyJetFanOutOutputT = z.infer<typeof EasyJetFanOutOutput>;

export const RyanairRangeRoutePayload = z.object({
  crawlRunId: z.string().uuid(),
  originIata: IATA,
  dateFrom: DateStr,
  dateTo: DateStr,
  destinationFilter: z.array(IATA).optional(),
  adults: z.number().int().min(1).max(9).default(CRAWL_CONFIG.ryanair.adults),
  requestDelayMs: RequestDelayMs.default(CRAWL_CONFIG.ryanair.requestDelayMs),
  requestJitterMs: RequestJitterMs.default(CRAWL_CONFIG.ryanair.requestJitterMs),
  cooldownMs: z
    .number()
    .int()
    .min(0)
    .max(60 * 60 * 24 * 1000)
    .default(CRAWL_CONFIG.ryanair.cooldownMs),
});

export type RyanairRangeRoutePayloadT = z.infer<
  typeof RyanairRangeRoutePayload
>;

export const RyanairRangeRouteOutput = z.object({
  originIata: z.string(),
  dateFrom: DateStr,
  dateTo: DateStr,
  flexDaysBefore: z.number().int(),
  flexDaysAfter: z.number().int(),
  destinations: z.array(z.string()),
  requestsMade: z.number().int(),
  rowsInserted: z.number().int(),
  errors: z.array(
    z.object({ origin: z.string(), date: z.string(), message: z.string() })
  ),
  durationMs: z.number().int(),
});

export type RyanairRangeRouteOutputT = z.infer<
  typeof RyanairRangeRouteOutput
>;

export const RyanairRangeFanOutPayload = z.object({
  crawlRunId: z.string().uuid(),
  origins: z.array(IATA).min(1),
  destinationFilter: z.array(IATA).optional(),
  dateFrom: DateStr,
  dateTo: DateStr,
  adults: z.number().int().min(1).max(9).default(CRAWL_CONFIG.ryanair.adults),
  requestDelayMs: RequestDelayMs.default(CRAWL_CONFIG.ryanair.requestDelayMs),
  requestJitterMs: RequestJitterMs.default(CRAWL_CONFIG.ryanair.requestJitterMs),
  cooldownMs: z
    .number()
    .int()
    .min(0)
    .max(60 * 60 * 24 * 1000)
    .default(CRAWL_CONFIG.ryanair.cooldownMs),
});

export type RyanairRangeFanOutPayloadT = z.infer<
  typeof RyanairRangeFanOutPayload
>;

export const RyanairRangeFanOutOutput = z.object({
  crawlRunId: z.string().uuid(),
  origins: z.array(z.string()),
  dateFrom: DateStr,
  dateTo: DateStr,
  totalRequests: z.number().int(),
  rowsInserted: z.number().int(),
  durationMs: z.number().int(),
});

export type RyanairRangeFanOutOutputT = z.infer<
  typeof RyanairRangeFanOutOutput
>;
