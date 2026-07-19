import type {
  AirlineCrawler,
  CrawlResult,
  CrawlRunContext,
} from "./types";
import type { FlightListingInput } from "../lib/flight-listing";
import { pacedFetch, Pacer } from "../lib/paced-fetch";
import { CRAWL_CONFIG } from "../config";

const EASYJET_AVAILABILITY_URL =
  "https://www.easyjet.com/homepage/api/availability";

const EASYJET_REFERER = "https://www.easyjet.com";

const EASYJET_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";

const EASYJET_DEFAULT_BASES = [
  "AGP",
  "AMS",
  "ATH",
  "BCN",
  "BDS",
  "BER",
  "BFS",
  "BGY",
  "BHX",
  "BOD",
  "BRE",
  "BRI",
  "BRS",
  "BRU",
  "BUD",
  "BVA",
  "CDT",
  "CFU",
  "CTA",
  "DOL",
  "DUB",
  "DUS",
  "EDI",
  "EMA",
  "FCO",
  "FSC",
  "FUE",
  "GLA",
  "GOA",
  "GRO",
  "GRX",
  "HAU",
  "HHN",
  "INN",
  "JER",
  "KLX",
  "LGW",
  "LIR",
  "LIS",
  "LTN",
  "LYS",
  "MAD",
  "MAN",
  "MRS",
  "MXP",
  "NAP",
  "NCE",
  "NCL",
  "NTE",
  "NWI",
  "OGS",
  "OLB",
  "OPO",
  "ORK",
  "OTP",
  "OUD",
  "PAD",
  "PMI",
  "PMO",
  "PSA",
  "RAK",
  "RHO",
  "RJK",
  "RTM",
  "SNN",
  "SOF",
  "SPU",
  "STN",
  "STR",
  "SUF",
  "SVQ",
  "TFS",
  "TLL",
  "TLS",
  "TNG",
  "TPS",
  "TRN",
  "VCE",
  "VLC",
  "VLE",
  "VRN",
  "ZTH",
];

const easyjetPacer = new Pacer(
  CRAWL_CONFIG.easyjet.requestDelayMs,
  CRAWL_CONFIG.easyjet.requestJitterMs
);

async function easyjetPacedFetch(url: string, init?: RequestInit): Promise<Response> {
  return pacedFetch(easyjetPacer, url, init);
}

type EasyJetAvailabilityResponse = {
  startDate?: string;
  endDate?: string;
  departureFlights?: Array<{
    date?: string;
    price?: number | null;
    lowFare?: boolean;
  }>;
};

type EasyJetAirportMeta = {
  code: string;
  name: string;
  city: string;
};

let airportCache: Map<string, EasyJetAirportMeta> | null = null;

async function fetchEasyJetAvailability(
  origin: string,
  destination: string,
  options: {
    dateFrom: string;
    dateTo: string;
    currency?: string;
    isReturn?: boolean;
    isWorldwide?: boolean;
  }
): Promise<EasyJetAvailabilityResponse> {
  return fetchEasyJetAvailabilityWithRetry(origin, destination, options);
}

async function fetchEasyJetAvailabilityWithRetry(
  origin: string,
  destination: string,
  options: {
    dateFrom: string;
    dateTo: string;
    currency?: string;
    isReturn?: boolean;
    isWorldwide?: boolean;
  },
  attempt = 0
): Promise<EasyJetAvailabilityResponse> {
  const params = new URLSearchParams({
    origin: origin.toUpperCase(),
    destination: destination.toUpperCase(),
    currency: options.currency ?? "GBP",
    isReturn: options.isReturn ? "true" : "false",
    startDate: options.dateFrom,
    endDate: options.dateTo,
    isWorldwide: options.isWorldwide ? "true" : "false",
  });

  const maxAttempts = 4;
  const res = await easyjetPacedFetch(
    `${EASYJET_AVAILABILITY_URL}?${params.toString()}`,
    {
      method: "GET",
      headers: {
        accept: "application/json, text/plain, */*",
        "accept-language": "en-GB,en;q=0.9",
        referer: EASYJET_REFERER,
        "user-agent": EASYJET_USER_AGENT,
      },
    }
  );

  const { status } = res;
  const retryable =
    status === 429 || status === 503 || status === 403 || status >= 500;

  if (res.ok && !retryable) {
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      const body = await res.text();
      throw new Error(
        `EasyJet ${origin}→${destination} unexpected content-type ${contentType}: ${body.slice(
          0,
          200
        )}`
      );
    }
    return (await res.json()) as EasyJetAvailabilityResponse;
  }

  if (retryable && attempt + 1 < maxAttempts) {
    const retryAfterHeader = res.headers.get("retry-after");
    const retryAfterSec = retryAfterHeader
      ? Number(retryAfterHeader)
      : NaN;
    const baseBackoffMs =
      retryAfterSec && Number.isFinite(retryAfterSec)
        ? Math.max(0, retryAfterSec) * 1000
        : Math.min(15_000, 1_000 * 2 ** attempt);
    const jitterMs = Math.floor(Math.random() * 500);
    const waitMs = baseBackoffMs + jitterMs;
    await new Promise((r) => setTimeout(r, waitMs));
    return fetchEasyJetAvailabilityWithRetry(
      origin,
      destination,
      options,
      attempt + 1
    );
  }

  throw new Error(
    `EasyJet ${origin}→${destination} HTTP ${status} ${res.statusText}`
  );
}

class RunResponseCache {
  private map = new Map<
    string,
    Promise<EasyJetAvailabilityResponse>
  >();
  getOrFetch(
    key: string,
    loader: () => Promise<EasyJetAvailabilityResponse>
  ): Promise<EasyJetAvailabilityResponse> {
    const existing = this.map.get(key);
    if (existing) return existing;
    const p = loader();
    this.map.set(key, p);
    return p;
  }
}

function cacheKey(parts: {
  origin: string;
  destination: string;
  dateFrom: string;
  dateTo: string;
  currency: string;
}): string {
  return [
    parts.origin,
    parts.destination,
    parts.dateFrom,
    parts.dateTo,
    parts.currency,
  ].join("|");
}

function rowFromFlight(
  origin: string,
  destination: string,
  flightDate: string,
  price: number,
  currency: string,
  lowFare: boolean,
  observedAtIso: string,
  source: string,
  raw: Record<string, unknown>
): FlightListingInput {
  return {
    airline: "EasyJet",
    airline_code: "U2",
    origin_iata: origin.toUpperCase(),
    destination_iata: destination.toUpperCase(),
    flight_number: "",
    departure_date: flightDate,
    departure_datetime: null,
    arrival_datetime: null,
    duration_minutes: null,
    currency: currency.toUpperCase(),
    price,
    original_price: null,
    fare_type: lowFare ? "LOW_FARE" : "STANDARD",
    fare_class: lowFare ? "LOW_FARE" : "STANDARD",
    seats_left: null,
    observed_at: observedAtIso,
    source,
    search_origin: origin,
    raw,
  };
}

function parseEasyJetFlights(
  origin: string,
  destination: string,
  response: EasyJetAvailabilityResponse,
  observedAtIso: string,
  source: string,
  currency: string
): FlightListingInput[] {
  const rows: FlightListingInput[] = [];
  const flights = response.departureFlights ?? [];

  for (const flight of flights) {
    if (!flight.date) continue;
    const price = flight.price;
    if (price === null || price === undefined) continue;

    rows.push(
      rowFromFlight(
        origin,
        destination,
        flight.date,
        price,
        currency,
        flight.lowFare ?? false,
        observedAtIso,
        source,
        flight as unknown as Record<string, unknown>
      )
    );
  }

  return rows;
}

async function loadEasyJetSkipKeys(
  origins: string[],
  destinations: string[],
  cooldownMs: number
): Promise<Set<string>> {
  if (cooldownMs <= 0) return new Set();
  if (origins.length === 0 || destinations.length === 0) return new Set();
  try {
    const { getRecentlySeenKeys } = await import("../db/flight-listings");
    const keys = await getRecentlySeenKeys({
      airline: "EasyJet",
      sinceMinutes: Math.ceil(cooldownMs / 60_000),
    });
    const filtered = new Set<string>();
    for (const key of keys) {
      const [keyOrigin, keyDate] = key.split("|");
      if (
        keyOrigin &&
        origins.includes(keyOrigin.toUpperCase())
      ) {
        filtered.add(key);
      }
    }
    return filtered;
  } catch {
    return new Set();
  }
}

export async function crawlEasyJetForOrigin(
  originIata: string,
  destinations: string[],
  ctx: {
    crawlRunId: string;
    observedAt: Date;
    dateFrom: string;
    dateTo: string;
    currency?: string;
    requestDelayMs?: number;
    requestJitterMs?: number;
    cooldownMs?: number;
  }
): Promise<CrawlResult> {
  const observedAtIso = ctx.observedAt.toISOString();
  const currency = ctx.currency ?? "GBP";
  const cooldownMs = ctx.cooldownMs ?? CRAWL_CONFIG.easyjet.cooldownMs;

  const skipKeys = await loadEasyJetSkipKeys(
    [originIata],
    destinations,
    cooldownMs
  );

  const filtered = destinations.filter(
    (dest) => !skipKeys.has(`${originIata.toUpperCase()}|${dest}`)
  );
  const requestsSkipped = destinations.length - filtered.length;

  const cache = new RunResponseCache();
  let requestsMade = 0;
  let cacheHits = 0;

  const rows: FlightListingInput[] = [];
  const errors: CrawlResult["errors"] = [];
  const destinationsScanned = new Set<string>();

  for (const dest of filtered) {
    try {
      const key = cacheKey({
        origin: originIata,
        destination: dest,
        dateFrom: ctx.dateFrom,
        dateTo: ctx.dateTo,
        currency,
      });
      let isCacheHit = true;
      const res = await cache.getOrFetch(key, async () => {
        isCacheHit = false;
        requestsMade += 1;
        return fetchEasyJetAvailability(originIata, dest, {
          dateFrom: ctx.dateFrom,
          dateTo: ctx.dateTo,
          currency,
          isReturn: false,
          isWorldwide: false,
        });
      });
      if (isCacheHit) cacheHits += 1;

      const parsed = parseEasyJetFlights(
        originIata,
        dest,
        res,
        observedAtIso,
        "easyjet.com",
        currency
      );
      rows.push(...parsed);
      destinationsScanned.add(dest.toUpperCase());
    } catch (err) {
      errors.push({
        origin: originIata,
        date: dest,
        message: (err as Error).message,
      });
    }
  }

  return {
    rows: dedupeEasyJetRows(rows),
    rowsInserted: 0,
    errors,
    destinationsScanned,
    requestsMade,
    cacheHits,
    requestsSkipped,
  };
}

function dedupeEasyJetRows(rows: FlightListingInput[]): FlightListingInput[] {
  const seen = new Map<string, FlightListingInput>();
  for (const row of rows) {
    const key = `${row.airline}|${row.origin_iata}|${row.destination_iata}|${row.departure_date}`;
    if (!seen.has(key)) seen.set(key, row);
  }
  return [...seen.values()];
}

export async function crawlEasyJet(ctx: CrawlRunContext): Promise<CrawlResult> {
  const { config, observedAt } = ctx;
  const observedAtIso = observedAt.toISOString();
  const searchOrigin = config.origins[0] ?? "N/A";
  const currency = "GBP";

  const allDestinations = config.destinationFilter ?? EASYJET_DEFAULT_BASES;
  const filteredDestinations = allDestinations.filter(
    (d) => !config.origins.includes(d)
  );

  const skipKeys = await loadEasyJetSkipKeys(
    config.origins,
    filteredDestinations,
    config.cooldownMs ?? 30 * 60 * 1000
  );

  const tasks: Array<{
    origin: string;
    destination: string;
  }> = [];

  for (const origin of config.origins) {
    for (const dest of filteredDestinations) {
      const key = `${origin.toUpperCase()}|${dest.toUpperCase()}`;
      if (!skipKeys.has(key)) {
        tasks.push({ origin, destination: dest });
      }
    }
  }

  const requestsSkipped =
    config.origins.length * filteredDestinations.length - tasks.length;

  const cache = new RunResponseCache();
  let requestsMade = 0;
  let cacheHits = 0;

  const rows: FlightListingInput[] = [];
  const errors: CrawlResult["errors"] = [];
  const destinations = new Set<string>();

  async function worker(): Promise<void> {
    while (true) {
      const task = tasks.shift();
      if (!task) return;
      try {
        const key = cacheKey({
          origin: task.origin,
          destination: task.destination,
          dateFrom: config.dateFrom,
          dateTo: config.dateTo,
          currency,
        });
        let isCacheHit = true;
        const res = await cache.getOrFetch(key, async () => {
          isCacheHit = false;
          requestsMade += 1;
          return fetchEasyJetAvailability(task.origin, task.destination, {
            dateFrom: config.dateFrom,
            dateTo: config.dateTo,
            currency,
            isReturn: false,
            isWorldwide: false,
          });
        });
        if (isCacheHit) cacheHits += 1;

        const parsed = parseEasyJetFlights(
          task.origin,
          task.destination,
          res,
          observedAtIso,
          "easyjet.com",
          currency
        );
        rows.push(...parsed);
        destinations.add(task.destination.toUpperCase());
      } catch (err) {
        errors.push({
          origin: task.origin,
          date: task.destination,
          message: (err as Error).message,
        });
      }
    }
  }

  const workerCount = Math.min(
    Math.max(1, config.concurrency),
    Math.max(1, tasks.length)
  );
  if (tasks.length > 0) {
    await Promise.all(
      Array.from({ length: workerCount }, () => worker())
    );
  }

  return {
    rows,
    rowsInserted: 0,
    errors,
    destinationsScanned: destinations,
    requestsMade,
    cacheHits,
    requestsSkipped,
  };
}

export const easyjetCrawler: AirlineCrawler = {
  code: "U2",
  name: "EasyJet",
  defaultOrigins: EASYJET_DEFAULT_BASES,
  crawl: crawlEasyJet,
};
