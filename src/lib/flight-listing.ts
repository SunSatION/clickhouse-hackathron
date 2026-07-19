import { z } from "zod";

export const IATA_CODE = /^[A-Z]{3}$/;

export const DateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
export const TimeString = z
  .string()
  .regex(/^\d{2}:\d{2}(:\d{2})?$/, "expected HH:MM[:SS]");

export const FlightListingSchema = z.object({
  airline: z.string().min(1),
  airline_code: z.string().min(2).max(3),

  origin_iata: z.string().regex(IATA_CODE),
  destination_iata: z.string().regex(IATA_CODE),

  flight_number: z.string().default(""),

  departure_date: DateString,
  departure_datetime: z.string().datetime({ offset: true }).nullable(),
  arrival_datetime: z.string().datetime({ offset: true }).nullable(),
  duration_minutes: z.number().int().nonnegative().nullable(),

  currency: z.string().length(3).toUpperCase(),
  price: z.number().nonnegative(),
  original_price: z.number().nonnegative().nullable(),
  fare_type: z.string().default(""),
  fare_class: z.string().default(""),
  seats_left: z.number().int().nonnegative().nullable(),

  observed_at: z
    .string()
    .datetime({ offset: true })
    .transform((s) => new Date(s).toISOString()),
  source: z.string().min(1),
  search_origin: z.string().min(1),
  raw: z.record(z.string(), z.unknown()).default({}),
  crawl_run_id: z.string().uuid(),
});

export type FlightListing = z.infer<typeof FlightListingSchema>;
export type FlightListingInput = Omit<FlightListing, "crawl_run_id">;

export const CrawlConfigSchema = z.object({
  origins: z.array(z.string().regex(IATA_CODE)).nonempty(),
  destinationFilter: z
    .array(z.string().regex(IATA_CODE))
    .optional(),
  dateFrom: DateString,
  dateTo: DateString,
  flexDaysBefore: z.number().int().min(0).max(30).default(0),
  flexDaysAfter: z.number().int().min(0).max(30).default(14),
  adults: z.number().int().min(1).max(9).default(1),
  concurrency: z.number().int().min(1).max(20).default(2),
  requestDelayMs: z.number().int().min(0).max(10_000).default(700),
  requestJitterMs: z.number().int().min(0).max(5_000).default(400),
  cooldownMs: z.number().int().min(0).max(60 * 60 * 24 * 1000).default(30 * 60 * 1000),
});

export type CrawlConfig = z.infer<typeof CrawlConfigSchema>;

export const CrawlSummarySchema = z.object({
  airline: z.string(),
  originsScanned: z.number().int(),
  destinationsScanned: z.number().int(),
  departureDatesScanned: z.number().int(),
  rowsInserted: z.number().int(),
  cheapestFareByRoute: z.record(
    z.object({
      destination_iata: z.string(),
      min_price: z.number(),
      currency: z.string(),
      departure_date: z.string(),
    })
  ),
  startedAt: z.string().datetime({ offset: true }),
  finishedAt: z.string().datetime({ offset: true }),
  durationMs: z.number().int(),
  errors: z.array(
    z.object({
      origin: z.string(),
      date: z.string(),
      message: z.string(),
    })
  ),
});

export type CrawlSummary = z.infer<typeof CrawlSummarySchema>;
