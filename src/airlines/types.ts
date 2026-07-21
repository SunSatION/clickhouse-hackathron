import type { CrawlConfig, CrawlSummary, FlightListingInput } from "../lib/flight-listing.js";

export type CrawlRunContext = {
  crawlRunId: string;
  observedAt: Date;
  config: CrawlConfig;
};

export type CrawlResult = {
  rows: FlightListingInput[];
  errors: { origin: string; date: string; message: string }[];
  destinationsScanned: Set<string>;
  requestsMade: number;
  cacheHits: number;
  requestsSkipped: number;
  rowsInserted: number;
};

export type AirlineCrawler = {
  code: string;
  name: string;
  defaultOrigins: string[];
  crawl: (ctx: CrawlRunContext) => Promise<CrawlResult>;
};

export type FanOutInput = {
  origins?: string[];
  destinationFilter?: string[];
  dateFrom?: string;
  dateTo?: string;
  flexDaysBefore?: number;
  flexDaysAfter?: number;
  adults?: number;
  concurrency?: number;
};

export type FanOutResult = {
  originsScanned: number;
  destinationsScanned: number;
  departureDatesScanned: number;
  rowsInserted: number;
  errors: { origin: string; date: string; message: string }[];
};

export type PerOriginInput = {
  originIata: string;
  destinationFilter?: string[];
  dateFrom: string;
  dateTo: string;
  flexDaysBefore: number;
  flexDaysAfter: number;
  adults: number;
  crawlRunId: string;
};

export type PerOriginResult = {
  originIata: string;
  destinationsScanned: number;
  departureDatesScanned: number;
  rowsInserted: number;
  errors: { origin: string; date: string; message: string }[];
};

export type CrawlAirlineSummary = CrawlSummary & {
  code: string;
};
