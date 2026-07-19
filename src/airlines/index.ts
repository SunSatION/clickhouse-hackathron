import type { AirlineCrawler } from "./types";
import { ryanairCrawler } from "./ryanair";

export const AIRLINE_CRAWLERS: AirlineCrawler[] = [ryanairCrawler];

export const AIRLINE_CRAWLER_BY_CODE: Record<string, AirlineCrawler> = Object.fromEntries(
  AIRLINE_CRAWLERS.map((c) => [c.code, c])
);
