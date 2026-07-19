/**
 * Crawl tuning parameters. All values are env-overridable so scripts, trigger
 * tasks and airline crawlers pull from a single source of truth.
 *
 * Defaults are conservative (Ryanair gates aggressively; we use 5s spacing +
 * concurrencyLimit 1 on the range-route task to stay under one request every
 * 5 seconds globally). Override per-deployment by setting the env vars.
 */
function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export type CrawlRateConfig = {
  /** Min ms between requests within one crawler run. */
  requestDelayMs: number;
  /** Random extra ms added on top of `requestDelayMs`. */
  requestJitterMs: number;
  /** Skip re-fetching a destination if it was crawled within this window. */
  cooldownMs: number;
  /** Adults requested per fare search. */
  adults: number;
};

export const CRAWL_CONFIG: {
  ryanair: CrawlRateConfig;
  easyjet: CrawlRateConfig;
} = {
  ryanair: {
    requestDelayMs: intEnv("CRAWL_RYANAIR_REQUEST_DELAY_MS", 20000),
    requestJitterMs: intEnv("CRAWL_RYANAIR_REQUEST_JITTER_MS", 10000),
    cooldownMs: intEnv("CRAWL_RYANAIR_COOLDOWN_MS", 0),
    adults: intEnv("CRAWL_RYANAIR_ADULTS", 1),
  },
  easyjet: {
    requestDelayMs: intEnv("CRAWL_EASYJET_REQUEST_DELAY_MS", 20000),
    requestJitterMs: intEnv("CRAWL_EASYJET_REQUEST_JITTER_MS", 10000),
    cooldownMs: intEnv("CRAWL_EASYJET_COOLDOWN_MS", 0),
    adults: intEnv("CRAWL_EASYJET_ADULTS", 1),
  },
};