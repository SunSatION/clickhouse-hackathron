import type {
  AirlineCrawler,
  CrawlResult,
  CrawlRunContext,
} from "./types";
import type { FlightListingInput } from "../lib/flight-listing";
import { pacedFetch, Pacer } from "../lib/paced-fetch";
import { CRAWL_CONFIG } from "../config";
import { logger } from "../lib/logger";

const FILE = "src/airlines/ryanair.ts";
const log = logger(FILE);

const RYANAIR_AVAILABILITY_URL =
  "https://www.ryanair.com/api/booking/v4/en-gb/availability";

const RYANAIR_FARFND_URL =
  "https://www.ryanair.com/api/farfnd/v4/oneWayFares";

const RYANAIR_USE_FARFND = process.env.RYANAIR_USE_FARFND !== "false";

type RyanairCheapestPerDayResponse = {
  outbound: {
    fares: RyanairCheapestFare[];
    maxFare: RyanairCheapestFare;
    minFare: RyanairCheapestFare;
  };
};

type RyanairCheapestFare = {
  day: string;
  arrivalDate: string;
  departureDate: string;
  price: {
    value: number;
    valueMainUnit: string;
    valueFractionalUnit: string;
    currencyCode: string;
    currencySymbol: string;
  };
  soldOut: boolean;
  unavailable: boolean;
};

async function fetchRyanairCheapestPerDay(
  origin: string,
  destination: string,
  monthDate: string,
  currency = "EUR"
): Promise<RyanairCheapestPerDayResponse> {
  const url = `${RYANAIR_FARFND_URL}/${origin}/${destination}/cheapestPerDay?outboundMonthOfDate=${monthDate}&currency=${currency}`;
  const res = await ryanairPacedFetch(url, {
    method: "GET",
    headers: {
      accept: "application/json, text/plain, */*",
      "accept-language": "en-GB,en;q=0.6",
      client: RYANAIR_CLIENT,
      "client-version": RYANAIR_CLIENT_VERSION,
      cookie: buildRyanairCookieHeader(),
      priority: "u=1, i",
      referer: `https://www.ryanair.com/mt/en/fare-finder?originIata=${origin}&dateOut=${monthDate}&dateIn=&isExactDate=true&outboundFromHour=00:00&outboundToHour=23:59&priceValueTo=&currency=${currency}&destinationIata=${destination}&isReturn=false&isMacDestination=false&promoCode=&adults=1&teens=0&children=0&infants=0`,
      "sec-ch-ua": '"Not;A=Brand";v="8", "Chromium";v="150", "Brave";v="150"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      "sec-gpc": "1",
      "user-agent": RYANAIR_USER_AGENT,
    },
  });
  log.info(`FARFND ${origin}→${destination} ${monthDate} → HTTP ${res.status}`);
  if (!res.ok) {
    throw new Error(`Ryanair farfnd HTTP ${res.status} ${res.statusText} for ${origin}→${destination} month ${monthDate}`);
  }
  const json = (await res.json()) as RyanairCheapestPerDayResponse;
  return json;
}

function parseRyanairCheapestPerDayFares(
  fares: RyanairCheapestFare[],
  observedAtIso: string,
  source: string,
  originIata: string,
  destinationIata: string
): FlightListingInput[] {
  const rows: FlightListingInput[] = [];
  for (const fare of fares) {
    if (fare.soldOut || fare.unavailable) continue;
    const departureDate = fare.departureDate.slice(0, 10);
    rows.push({
      airline: "Ryanair",
      airline_code: "FR",
      origin_iata: originIata.toUpperCase(),
      destination_iata: destinationIata.toUpperCase(),
      flight_number: "",
      departure_date: departureDate,
      departure_datetime: fare.departureDate,
      arrival_datetime: fare.arrivalDate,
      duration_minutes: null,
      currency: fare.price.currencyCode,
      price: fare.price.value,
      original_price: null,
      fare_type: "",
      fare_class: "",
      seats_left: null,
      observed_at: observedAtIso,
      source,
      search_origin: originIata,
      raw: fare as unknown as Record<string, unknown>,
    });
  }
  return rows;
}

const RYANAIR_AGREE_TERMS_URL =
  "https://www.ryanair.com/api/agree-terms";

const RYANAIR_REFERER = "https://www.ryanair.com/gb/en";
const RYANAIR_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";

const RYANAIR_CLIENT = "desktop";
const RYANAIR_CLIENT_VERSION = "3.206.0";
const RYANAIR_CORRELATION_ID = process.env.RYANAIR_CORRELATION_ID ?? "00000000-0000-0000-0000-000000000000";

/**
 * `xid=…` session token Ryanair issues per browser session. The booking
 * availability API rejects requests without it with `409 Availability
 * declined` regardless of which ToU/consent cookies are sent. Generate it by
 * opening https://www.ryanair.com/gb/en in a browser, then copying the `xid`
 * value from devtools >>> Application >>> Cookies. Note: it expires — re-grab
 * when the API starts returning 409 again.
 */
const RYANAIR_XID_COOKIE = process.env.RYANAIR_XID_COOKIE ?? "";

function buildRyanairCookieHeader(): string {
  log.trace(">>> buildRyanairCookieHeader enter", { cls: "Ryanair", fn: "buildRyanairCookieHeader" });
  const start = Date.now();
  const parts = [`fr-correlation-id=${RYANAIR_CORRELATION_ID}`];
  if (RYANAIR_XID_COOKIE) parts.push(RYANAIR_XID_COOKIE);
  log.trace("<<< buildRyanairCookieHeader exit", { cls: "Ryanair", fn: "buildRyanairCookieHeader", waitMs: Date.now() - start });
  return parts.join("; ");
}

const RYANAIR_AIRPORTS_URL =
  "https://www.ryanair.com/api/views/locate/5/airports/en/active";

const ryanairPacer = new Pacer(
  CRAWL_CONFIG.ryanair.requestDelayMs,
  CRAWL_CONFIG.ryanair.requestJitterMs
);

async function ryanairPacedFetch(url: string, init?: RequestInit): Promise<Response> {
  return pacedFetch(ryanairPacer, url, init);
}

export interface RyanairAirport {
  code: string;
  name: string;
  city: string;
  country: string;
  base: boolean;
}

/**
 * Fetch the full list of active Ryanair airports. Used by the route-sync
 * script to seed `airline_routes` for every origin.
 */
export async function fetchRyanairAirports(): Promise<RyanairAirport[]> {
  log.trace(">>> fetchRyanairAirports enter", { cls: "Ryanair", fn: "fetchRyanairAirports" });
  const start = Date.now();
  const res = await ryanairPacedFetch(RYANAIR_AIRPORTS_URL, {
    headers: {
      accept: "application/json",
      "user-agent": RYANAIR_USER_AGENT,
      cookie: buildRyanairCookieHeader(),
    },
  });
  if (!res.ok) {
    throw new Error(
      `Ryanair active airports HTTP ${res.status} ${res.statusText}`
    );
  }
  const data = (await res.json()) as Array<{
    code?: string;
    name?: string;
    base?: boolean;
    city?: { name?: string };
    country?: { name?: string };
  }>;
  const out: RyanairAirport[] = [];
  for (const a of data) {
    if (!a.code) continue;
    out.push({
      code: a.code.toUpperCase(),
      name: a.name ?? "",
      city: a.city?.name ?? "",
      country: a.country?.name ?? "",
      base: Boolean(a.base),
    });
  }
  log.trace("<<< fetchRyanairAirports exit", { cls: "Ryanair", fn: "fetchRyanairAirports", waitMs: Date.now() - start });
  return out;
}

export class RyanairTermsOfUseError extends Error {
  readonly origin: string;
  readonly date: string;
  constructor(origin: string, date: string, message: string) {
    super(`Ryanair ${origin}@${date} terms of use not accepted: ${message}`);
    this.name = "RyanairTermsOfUseError";
    this.origin = origin;
    this.date = date;
  }
}

function isTermsOfUseRejection(
  status: number,
  body: { code?: string; message?: string } | null
): boolean {
  // log.trace(">>> isTermsOfUseRejection enter", { cls: "Ryanair", fn: "isTermsOfUseRejection" });
  const start = Date.now();
  if (!body) return false;
  if (body.code === "TermsOfUseAreNotAccepted") return true;
  if (status === 409 && /availability declined/i.test(body.message ?? "")) return true;
  // log.trace("<<< isTermsOfUseRejection exit", { cls: "Ryanair", fn: "isTermsOfUseRejection", waitMs: Date.now() - start });
  return false;
}

let _termsAttemptedForCorrelation: string | null = null;

async function postAgreeTerms(): Promise<boolean> {
  log.trace(">>> postAgreeTerms enter", { cls: "Ryanair", fn: "postAgreeTerms" });
  const start = Date.now();
  try {
    const res = await ryanairPacedFetch(RYANAIR_AGREE_TERMS_URL, {
      method: "POST",
      headers: {
        accept: "application/json",
        client: RYANAIR_CLIENT,
        "client-version": RYANAIR_CLIENT_VERSION,
        "content-type": "application/json",
        cookie: buildRyanairCookieHeader(),
        origin: RYANAIR_REFERER,
        referer: RYANAIR_REFERER,
        "user-agent": RYANAIR_USER_AGENT,
      },
      body: "{}",
    });
    log.trace("<<< postAgreeTerms exit", { cls: "Ryanair", fn: "postAgreeTerms", waitMs: Date.now() - start });
    return res.ok;
  } catch {
    log.trace("<<< postAgreeTerms exit (error)", { cls: "Ryanair", fn: "postAgreeTerms", waitMs: Date.now() - start });
    return false;
  }
}

export const RYANAIR_DEFAULT_BASES = [
  "AAR",
  "ABZ",
  "ACE",
  "AGA",
  "AGP",
  "AHO",
  "ALC",
  "AMM",
  "AMS",
  "AOI",
  "ARN",
  "ATH",
  "BBU",
  "BCN",
  "BDS",
  "BEM",
  "BER",
  "BFS",
  "BGY",
  "BHX",
  "BIQ",
  "BJV",
  "BLQ",
  "BNX",
  "BOH",
  "BOJ",
  "BRE",
  "BRI",
  "BRQ",
  "BRS",
  "BRU",
  "BSL",
  "BTS",
  "BUD",
  "BVA",
  "BVE",
  "BZG",
  "BZR",
  "CAG",
  "CCF",
  "CDT",
  "CFU",
  "CGN",
  "CHQ",
  "CIA",
  "CLJ",
  "CPH",
  "CRL",
  "CRV",
  "CTA",
  "CUF",
  "CWL",
  "DBV",
  "DLE",
  "DLM",
  "DUB",
  "EDI",
  "EFL",
  "EGC",
  "EIN",
  "EMA",
  "ERH",
  "ESU",
  "EXT",
  "FAO",
  "FCO",
  "FDH",
  "FEZ",
  "FKB",
  "FMM",
  "FMO",
  "FNC",
  "FNI",
  "FRL",
  "FSC",
  "FUE",
  "GDN",
  "GLA",
  "GNB",
  "GOA",
  "GOT",
  "GRO",
  "HAM",
  "HEL",
  "HER",
  "HHN",
  "IAS",
  "IBZ",
  "INI",
  "JMK",
  "JSI",
  "JTR",
  "KGS",
  "KIR",
  "KLU",
  "KLX",
  "KRK",
  "KSC",
  "KTW",
  "KUN",
  "LBA",
  "LBC",
  "LCA",
  "LCJ",
  "LDE",
  "LDY",
  "LEI",
  "LGW",
  "LIG",
  "LIL",
  "LIS",
  "LNZ",
  "LPA",
  "LPL",
  "LRH",
  "LTN",
  "LUX",
  "LUZ",
  "LXS",
  "MAD",
  "MAH",
  "MAN",
  "MLA",
  "MME",
  "MMX",
  "MRS",
  "MXP",
  "NAP",
  "NCE",
  "NCL",
  "NDR",
  "NOC",
  "NQY",
  "NRN",
  "NTE",
  "NUE",
  "NWI",
  "OLB",
  "OPO",
  "ORK",
  "OSI",
  "OSL",
  "OSR",
  "OTP",
  "OUD",
  "OZZ",
  "PAD",
  "PDV",
  "PED",
  "PEG",
  "PFO",
  "PGF",
  "PIK",
  "PIS",
  "PLQ",
  "PMF",
  "PMI",
  "PMO",
  "POZ",
  "PRG",
  "PSA",
  "PSR",
  "PUY",
  "PVK",
  "QSR",
  "RAK",
  "RBA",
  "RDZ",
  "REG",
  "REU",
  "RHO",
  "RIX",
  "RJK",
  "RMI",
  "RMU",
  "RVN",
  "RZE",
  "SCN",
  "SCQ",
  "SDR",
  "SFT",
  "SJJ",
  "SKG",
  "SNN",
  "SOF",
  "SPU",
  "STN",
  "SUF",
  "SVQ",
  "SZG",
  "SZY",
  "SZZ",
  "TFS",
  "TGD",
  "TIA",
  "TLL",
  "TLS",
  "TNG",
  "TPS",
  "TRF",
  "TRN",
  "TRS",
  "TSF",
  "TTU",
  "TUF",
  "VAR",
  "VCE",
  "VIE",
  "VIL",
  "VIT",
  "VLC",
  "VNO",
  "VOL",
  "VRN",
  "VST",
  "VXO",
  "WAW",
  "WMI",
  "WRO",
  "XCR",
  "ZAD",
  "ZAG",
  "ZAZ",
  "ZTH",
];

type RyanairFare = {
  type: string;
  amount: number;
  count: number;
  hasDiscount: boolean;
  publishedFare: number;
  discountInPercent: number;
  hasPromoDiscount: boolean;
  discountAmount: number;
  hasBogof: boolean;
  isPrime: boolean;
};

type RyanairSegment = {
  segmentNr: number;
  origin: string;
  destination: string;
  flightNumber: string;
  time: string[];
  timeUTC: string[];
  duration: string;
};

type RyanairFlight = {
  flightKey: string;
  flightNumber?: string;
  faresLeft: number;
  infantsLeft: number;
  regularFare: {
    fareKey: string;
    fareClass: string;
    fares?: RyanairFare[];
  };
  fares: RyanairFare[];
  timeUTC?: string[];
  duration?: string;
  segments: RyanairSegment[];
  operatedBy: string;
  isSSIMLoad: boolean;
};

type RyanairTripDate = {
  dateOut: string;
  flights: RyanairFlight[];
};

type RyanairTrip = {
  origin: string;
  originName: string;
  destination: string;
  destinationName: string;
  dates: RyanairTripDate[];
};

type RyanairAvailabilityResponse = {
  trips: RyanairTrip[];
  currency?: string;
};

async function fetchRyanairAvailability(
  origin: string,
  date: string,
  options: {
    destination?: string;
    adults?: number;
    flexDaysOut?: number;
    flexDaysBeforeOut?: number;
    roundTrip?: boolean;
    dateIn?: string;
  }
): Promise<RyanairAvailabilityResponse> {
  return fetchRyanairAvailabilityWithRetry(origin, date, options);
}

export interface RyanairRoute {
  destination_iata: string;
  destination_name: string;
  base: boolean;
}

export async function fetchRyanairRoutes(origin: string): Promise<RyanairRoute[]> {
  log.trace(">>> fetchRyanairRoutes enter", { cls: "Ryanair", fn: "fetchRyanairRoutes" });
  const start = Date.now();
  const url = `https://www.ryanair.com/api/views/locate/searchWidget/routes/en/airport/${origin.toUpperCase()}`;
  const referer = "https://www.ryanair.com/gb/en";
  const res = await ryanairPacedFetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": RYANAIR_USER_AGENT,
      referer,
      cookie: buildRyanairCookieHeader(),
    },
  });
  if (!res.ok) {
    throw new Error(`ryanair routes ${origin}: HTTP ${res.status}`);
  }
  const data = (await res.json()) as Array<{
    arrivalAirport?: { code?: string; name?: string; base?: boolean };
  }>;
  const routes: RyanairRoute[] = [];
  for (const entry of data) {
    const airport = entry.arrivalAirport;
    if (!airport?.code) continue;
    routes.push({
      destination_iata: airport.code.toUpperCase(),
      destination_name: airport.name ?? "",
      base: airport.base ?? false,
    });
  }
  log.trace("<<< fetchRyanairRoutes exit", { cls: "Ryanair", fn: "fetchRyanairRoutes", waitMs: Date.now() - start });
  return routes;
}

export const RYANAIR_BASES: readonly string[] = RYANAIR_DEFAULT_BASES;

export async function syncRyanairRoutes(
  origins?: string[]
): Promise<Map<string, number>> {
  log.trace(">>> syncRyanairRoutes enter", { cls: "Ryanair", fn: "syncRyanairRoutes" });
  const start = Date.now();
  const { upsertAirlineRoutes } = await import("../db/airline-routes");
  const list = (origins && origins.length > 0
    ? origins
    : Array.from(RYANAIR_DEFAULT_BASES)
  )
    .map((o) => o.toUpperCase())
    .filter((o, i, arr) => /^[A-Z]{3}$/.test(o) && arr.indexOf(o) === i);

  const counts = new Map<string, number>();
  for (const origin of list) {
    const routes = await fetchRyanairRoutes(origin);
    await upsertAirlineRoutes("Ryanair", origin, routes);
    counts.set(origin.toUpperCase(), routes.length);
  }
  log.trace("<<< syncRyanairRoutes exit", { cls: "Ryanair", fn: "syncRyanairRoutes", waitMs: Date.now() - start });
  return counts;
}

export interface SyncRyanairRoutesSummary {
  airports: number;
  originsAttempted: number;
  originsSucceeded: number;
  originsFailed: Array<{ origin: string; error: string }>;
  totalDestinations: number;
  perOrigin: Map<string, number>;
  durationMs: number;
}

/**
 * Bulk-sync Ryanair `airline_routes` for every origin in the airline's
 * active-airport catalogue. Runs `fetchRyanairRoutes` in parallel
 * (concurrency is bounded; rate-limited) and persists results to ClickHouse.
 */
export async function syncRyanairRoutesFromAirports(opts?: {
  concurrency?: number;
  onProgress?: (done: number, total: number, origin: string, n: number) => void;
}): Promise<SyncRyanairRoutesSummary> {
  log.trace(">>> syncRyanairRoutesFromAirports enter", { cls: "Ryanair", fn: "syncRyanairRoutesFromAirports" });
  const start = Date.now();
  const { upsertAirlineRoutes } = await import("../db/airline-routes");
  const concurrency = Math.max(1, opts?.concurrency ?? 1);
  const startedAt = Date.now();

  const airports = await fetchRyanairAirports();
  const queue = airports.slice();
  const perOrigin = new Map<string, number>();
  const failed: Array<{ origin: string; error: string }> = [];
  let succeeded = 0;
  let done = 0;

  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const airport = queue.shift();
      if (!airport) return;
      const origin = airport.code;
      try {
        const routes = await fetchRyanairRoutes(origin);
        await upsertAirlineRoutes("Ryanair", origin, routes);
        perOrigin.set(origin, routes.length);
        succeeded += 1;
        opts?.onProgress?.(++done, airports.length, origin, routes.length);
      } catch (err) {
        failed.push({ origin, error: (err as Error).message });
        opts?.onProgress?.(++done, airports.length, origin, -1);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const totalDestinations = [...perOrigin.values()].reduce((s, n) => s + n, 0);
  log.trace("<<< syncRyanairRoutesFromAirports exit", { cls: "Ryanair", fn: "syncRyanairRoutesFromAirports", waitMs: Date.now() - start });
  return {
    airports: airports.length,
    originsAttempted: airports.length,
    originsSucceeded: succeeded,
    originsFailed: failed,
    totalDestinations,
    perOrigin,
    durationMs: Date.now() - startedAt,
  };
}

// DISABLED — replaced by fetchRyanairCheapestPerDay (farfnd endpoint)
async function fetchRyanairAvailabilityWithRetry(
  origin: string,
  date: string,
  options: {
    destination?: string;
    adults?: number;
    flexDaysOut?: number;
    flexDaysBeforeOut?: number;
    roundTrip?: boolean;
    dateIn?: string;
  },
  attempt = 0
): Promise<RyanairAvailabilityResponse> {
  log.trace(">>> fetchRyanairAvailabilityWithRetry enter", { cls: "Ryanair", fn: "fetchRyanairAvailabilityWithRetry", waitMs: 0 });
  const start = Date.now();
  const adults = options.adults ?? 1;
  const params = new URLSearchParams({
    ADT: String(adults),
    TEEN: "0",
    CHD: "0",
    INF: "0",
    Origin: origin,
    Destination: options.destination ?? "",
    promoCode: "",
    IncludeConnectingFlights: "false",
    DateOut: date,
    DateIn: options.dateIn ?? "",
    FlexDaysBeforeOut: String(options.flexDaysBeforeOut ?? 0),
    FlexDaysOut: String(options.flexDaysOut ?? 0),
    FlexDaysBeforeIn: "0",
    FlexDaysIn: "0",
    RoundTrip: options.roundTrip ? "true" : "false",
    IncludePrimeFares: "false",
    ToUs: "AGREED",
  });

  const referer = new URL("https://www.ryanair.com/gb/en/trip/flights/select");
  referer.searchParams.set("adults", String(adults));
  referer.searchParams.set("children", "0");
  referer.searchParams.set("infants", "0");
  referer.searchParams.set("teens", "0");
  referer.searchParams.set("tpAdults", String(adults));
  referer.searchParams.set("tpChildren", "0");
  referer.searchParams.set("tpInfants", "0");
  referer.searchParams.set("tpTeens", "0");
  referer.searchParams.set("dateOut", date);
  referer.searchParams.set("tpStartDate", date);
  referer.searchParams.set("dateIn", options.dateIn ?? "");
  referer.searchParams.set("tpEndDate", options.dateIn ?? "");
  referer.searchParams.set("isReturn", options.roundTrip ? "true" : "false");
  referer.searchParams.set("discount", "0");
  referer.searchParams.set("tpDiscount", "0");
  referer.searchParams.set("originIata", origin);
  referer.searchParams.set("destinationIata", options.destination ?? "");
  referer.searchParams.set("tpOriginIata", origin);
  referer.searchParams.set("tpDestinationIata", options.destination ?? "");
  referer.searchParams.set("fromAISearch", "false");

  const maxAttempts = 4;
  const res = await ryanairPacedFetch(`${RYANAIR_AVAILABILITY_URL}?${params.toString()}`, {
    method: "GET",
    headers: {
      accept: "application/json, text/plain, */*",
      "accept-language": "en-GB,en;q=0.6",
      client: RYANAIR_CLIENT,
      "client-version": RYANAIR_CLIENT_VERSION,
      cookie: buildRyanairCookieHeader(),
      "priority": "u=1, i",
      referer: referer.toString(),
      "sec-ch-ua":
        '"Not;A=Brand";v="8", "Chromium";v="150", "Brave";v="150"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      "sec-gpc": "1",
      "user-agent": RYANAIR_USER_AGENT,
    },
  });

  const { status } = res;
  const retryable = status === 429 || status === 503 || status === 403 || status >= 500;
  if (res.ok && !retryable) {
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      const body = await res.text();
      throw new Error(
        `Ryanair ${origin}@${date} unexpected content-type ${contentType}: ${body.slice(
          0,
          200
        )}`
      );
    }
    const json = (await res.json()) as RyanairAvailabilityResponse & {
      code?: string;
      message?: string;
    };
    if (isTermsOfUseRejection(status, json)) {
      if (_termsAttemptedForCorrelation !== RYANAIR_CORRELATION_ID) {
        _termsAttemptedForCorrelation = RYANAIR_CORRELATION_ID;
        const accepted = await postAgreeTerms();
        if (accepted) {
          return fetchRyanairAvailabilityWithRetry(origin, date, options, attempt);
        }
      }
      throw new RyanairTermsOfUseError(origin, date, json.message ?? json.code ?? "");
    }
    log.trace("<<< fetchRyanairAvailabilityWithRetry exit", { cls: "Ryanair", fn: "fetchRyanairAvailabilityWithRetry", waitMs: Date.now() - start });
    return json;
  }

  if (!res.ok) {
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      try {
        const json = (await res.clone().json()) as {
          code?: string;
          message?: string;
        };
        if (isTermsOfUseRejection(status, json)) {
          if (_termsAttemptedForCorrelation !== RYANAIR_CORRELATION_ID) {
            _termsAttemptedForCorrelation = RYANAIR_CORRELATION_ID;
            const accepted = await postAgreeTerms();
            if (accepted) {
              return fetchRyanairAvailabilityWithRetry(origin, date, options, attempt);
            }
          }
          throw new RyanairTermsOfUseError(origin, date, json.message ?? json.code ?? "");
        }
      } catch {
        // fall through to generic handling below
      }
    }
  }

  if (retryable && attempt + 1 < maxAttempts) {
    const retryAfterHeader = res.headers.get("retry-after");
    const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : NaN;
    const baseBackoffMs = retryAfterSec && Number.isFinite(retryAfterSec)
      ? Math.max(0, retryAfterSec) * 1000
      : Math.min(15_000, 1_000 * 2 ** attempt);
    const jitterMs = Math.floor(Math.random() * 500);
    const waitMs = baseBackoffMs + jitterMs;
    await new Promise((r) => setTimeout(r, waitMs));
    return fetchRyanairAvailabilityWithRetry(origin, date, options, attempt + 1);
  }

  log.trace("<<< fetchRyanairAvailabilityWithRetry exit (error)", { cls: "Ryanair", fn: "fetchRyanairAvailabilityWithRetry", waitMs: Date.now() - start });
  throw new Error(
    `Ryanair ${origin}@${date} HTTP ${status} ${res.statusText}`
  );
}

class RunResponseCache {
  private map = new Map<string, Promise<RyanairAvailabilityResponse>>();
  getOrFetch(
    key: string,
    loader: () => Promise<RyanairAvailabilityResponse>
  ): Promise<RyanairAvailabilityResponse> {
    log.trace(">>> RunResponseCache.getOrFetch enter", { cls: "RunResponseCache", fn: "getOrFetch" });
    const start = Date.now();
    const existing = this.map.get(key);
    if (existing) {
      log.trace("<<< RunResponseCache.getOrFetch exit (cache hit)", { cls: "RunResponseCache", fn: "getOrFetch", waitMs: Date.now() - start });
      return existing;
    }
    const p = loader();
    this.map.set(key, p);
    log.trace("<<< RunResponseCache.getOrFetch exit (cache miss)", { cls: "RunResponseCache", fn: "getOrFetch", waitMs: Date.now() - start });
    return p;
  }
}

function cacheKey(parts: {
  origin: string;
  date: string;
  destination?: string;
  adults: number;
  flexDaysOut: number;
  flexDaysBeforeOut: number;
  roundTrip: boolean;
}): string {
  log.trace(">>> cacheKey enter", { cls: "Ryanair", fn: "cacheKey" });
  const start = Date.now();
  const result = [
    parts.origin,
    parts.date,
    parts.destination ?? "",
    parts.adults,
    parts.flexDaysOut,
    parts.flexDaysBeforeOut,
    parts.roundTrip ? "1" : "0",
  ].join("|");
  log.trace("<<< cacheKey exit", { cls: "Ryanair", fn: "cacheKey", waitMs: Date.now() - start });
  return result;
}

function parseRyanairTrips(
  trips: RyanairTrip[],
  observedAtIso: string,
  source: string,
  searchOrigin: string,
  destinationFilter: Set<string> | null
): { rows: FlightListingInput[]; destinationsScanned: Set<string> } {
  log.trace(">>> parseRyanairTrips enter", { cls: "Ryanair", fn: "parseRyanairTrips" });
  const start = Date.now();
  const rows: FlightListingInput[] = [];
  const destinationsScanned = new Set<string>();

  for (const trip of trips) {
    if (!trip.origin || !trip.destination) continue;
    if (destinationFilter && !destinationFilter.has(trip.destination))
      continue;

    for (const date of trip.dates) {
      const dateOutStr = date.dateOut;
      const dateOutDate = dateOutStr.slice(0, 10);

      for (const flight of date.flights) {
        const regularFare = flight.regularFare;
        if (!regularFare) continue;
        const fare = regularFare.fares?.[0];
        if (!fare) continue;

        const departureDatetime = flight.timeUTC?.[0] ?? null;
        const arrivalDatetime = flight.timeUTC?.[1] ?? null;

        const durationMatch = flight.duration?.match(/^(\d+):(\d{2})$/);
        const durationMinutes = durationMatch?.[1] && durationMatch?.[2]
          ? parseInt(durationMatch[1]) * 60 + parseInt(durationMatch[2])
          : null;

        rows.push({
          airline: "Ryanair",
          airline_code: "FR",
          origin_iata: trip.origin.toUpperCase(),
          destination_iata: trip.destination.toUpperCase(),
          flight_number: flight.flightNumber?.replace(/\s/g, "") ?? "",
          departure_date: dateOutDate,
          departure_datetime: departureDatetime,
          arrival_datetime: arrivalDatetime,
          duration_minutes: durationMinutes,
          currency: "EUR",
          price: fare.amount,
          original_price: fare.publishedFare > fare.amount ? fare.publishedFare : null,
          fare_type: regularFare.fareKey ?? "",
          fare_class: regularFare.fareClass ?? "",
          seats_left: sanitizeSeatsLeft(flight.faresLeft),
          observed_at: observedAtIso,
          source,
          search_origin: searchOrigin,
          raw: flight as unknown as Record<string, unknown>,
        });
        destinationsScanned.add(trip.destination.toUpperCase());
      }
    }
  }

  log.trace("<<< parseRyanairTrips exit", { cls: "Ryanair", fn: "parseRyanairTrips", waitMs: Date.now() - start });
  return { rows, destinationsScanned };
}

function eachDate(fromIso: string, toIso: string): string[] {
  log.trace(">>> eachDate enter", { cls: "Ryanair", fn: "eachDate" });
  const start = Date.now();
  const dates: string[] = [];
  const from = new Date(`${fromIso}T00:00:00Z`);
  const to = new Date(`${toIso}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return dates;
  if (from.getTime() > to.getTime()) return dates;
  const cursor = new Date(from.getTime());
  while (cursor.getTime() <= to.getTime()) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  log.trace("<<< eachDate exit", { cls: "Ryanair", fn: "eachDate", waitMs: Date.now() - start });
  return dates;
}

export async function crawlRyanair(ctx: CrawlRunContext): Promise<CrawlResult> {
  log.trace(">>> crawlRyanair enter", { cls: "Ryanair", fn: "crawlRyanair" });
  const start = Date.now();
  const { config, observedAt } = ctx;
  const observedAtIso = observedAt.toISOString();
  const searchOrigin = config.origins[0] ?? "N/A";
  const destinationFilter =
    config.destinationFilter && config.destinationFilter.length > 0
      ? new Set(config.destinationFilter.map((c) => c.toUpperCase()))
      : null;

  const dates = eachDate(config.dateFrom, config.dateTo);
  const cooldownMs = config.cooldownMs ?? CRAWL_CONFIG.ryanair.cooldownMs;
  const skipKeys = await loadRyanairSkipKeys(config.origins, cooldownMs);

  const { getRoutesForAirlineOrigins } = await import("../db/airline-routes");
  const routesByOrigin = await getRoutesForAirlineOrigins("Ryanair", config.origins);
  const allowedDestinationsByOrigin = new Map<string, Set<string> | null>();
  for (const origin of config.origins) {
    const set = routesByOrigin.get(origin.toUpperCase());
    allowedDestinationsByOrigin.set(
      origin.toUpperCase(),
      set && set.size > 0 ? set : null
    );
  }

  const queue: Array<{ origin: string; destination?: string; date: string }> = [];
  let requestsSkipped = 0;
  for (const origin of config.origins) {
    const allowed = allowedDestinationsByOrigin.get(origin.toUpperCase());
    const dests = destinationFilter
      ? [...destinationFilter].filter(
          (d) => !allowed || allowed.has(d.toUpperCase())
        )
      : allowed
      ? [...allowed]
      : null;
    if (dests && dests.length === 0) continue;
    for (const date of dates) {
      if (skipKeys.has(`${origin}|${date}`)) {
        requestsSkipped += dests ? dests.length : 1;
        continue;
      }
      if (dests) {
        for (const dest of dests) queue.push({ origin, destination: dest, date });
      } else {
        queue.push({ origin, date });
      }
    }
  }

  const cache = new RunResponseCache();
  let requestsMade = 0;
  let cacheHits = 0;

  const rows: FlightListingInput[] = [];
  const errors: CrawlResult["errors"] = [];
  const destinations = new Set<string>();

  async function worker(): Promise<void> {
    while (true) {
      const item = queue.shift();
      if (!item) return;
      try {
        const key = cacheKey({
          origin: item.origin,
          date: item.date,
          destination: item.destination,
          adults: config.adults,
          flexDaysOut: config.flexDaysAfter,
          flexDaysBeforeOut: config.flexDaysBefore,
          roundTrip: false,
        });
        let isCacheHit = true;
        const res = await cache.getOrFetch(key, async () => {
          isCacheHit = false;
          requestsMade += 1;
          return fetchRyanairAvailability(item.origin, item.date, {
            destination: item.destination,
            adults: config.adults,
            flexDaysOut: config.flexDaysAfter,
            flexDaysBeforeOut: config.flexDaysBefore,
            roundTrip: false,
          });
        });
        if (isCacheHit) cacheHits += 1;
        const parsed = parseRyanairTrips(
          res.trips ?? [],
          observedAtIso,
          "ryanair.com",
          searchOrigin,
          destinationFilter
        );
        rows.push(...parsed.rows);
        for (const d of parsed.destinationsScanned) destinations.add(d);
      } catch (err) {
        errors.push({
          origin: item.origin,
          date: item.date,
          message: (err as Error).message,
        });
      }
    }
  }

  const workerCount = Math.min(
    Math.max(1, config.concurrency),
    Math.max(1, queue.length)
  );
  if (queue.length > 0) {
    await Promise.all(
      Array.from({ length: workerCount }, () => worker())
    );
  }

  log.trace("<<< crawlRyanair exit", { cls: "Ryanair", fn: "crawlRyanair", waitMs: Date.now() - start });
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

export type RyanairForOriginLogger = {
  trace: (msg: string, meta?: Record<string, unknown>) => void;
  debug: (msg: string, meta?: Record<string, unknown>) => void;
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
};

const stdoutLogger: RyanairForOriginLogger = {
  trace: (msg, meta) => console.log(`[trace] ${msg}`, meta ?? ""),
  debug: (msg, meta) => console.log(`[debug] ${msg}`, meta ?? ""),
  info: (msg, meta) => console.log(`[info]  ${msg}`, meta ?? ""),
  warn: (msg, meta) => console.warn(`[warn]  ${msg}`, meta ?? ""),
  error: (msg, meta) => console.error(`[error] ${msg}`, meta ?? ""),
};

export type RyanairCallEvent = {
  index: number;
  total: number;
  origin: string;
  destination: string;
  dateFrom: string;
  dateTo: string;
  cacheHit: boolean;
  durationMs?: number;
  rowCount: number;
  flightCount: number;
};

function rangeCacheKey(parts: {
  origin: string;
  dateFrom: string;
  dateTo: string;
  destination: string;
  adults: number;
}): string {
  log.trace(">>> rangeCacheKey enter", { cls: "Ryanair", fn: "rangeCacheKey" });
  const start = Date.now();
  const result = [
    parts.origin,
    parts.dateFrom,
    parts.dateTo,
    parts.destination,
    parts.adults,
  ].join("|");
  log.trace("<<< rangeCacheKey exit", { cls: "Ryanair", fn: "rangeCacheKey", waitMs: Date.now() - start });
  return result;
}

export async function crawlRyanairForOrigin(
  originIata: string,
  dateFrom: string,
  dateTo: string,
  ctx: {
    crawlRunId: string;
    observedAt: Date;
    adults: number;
    destinationFilter?: string[];
    requestDelayMs?: number;
    requestJitterMs?: number;
    cooldownMs?: number;
    logger?: RyanairForOriginLogger;
    onCall?: (event: RyanairCallEvent) => void;
    persist?: boolean;
    airline?: "Ryanair";
    resumeFromProgress?: boolean;
  }
): Promise<CrawlResult> {
  log.trace(">>> crawlRyanairForOrigin enter", { cls: "Ryanair", fn: "crawlRyanairForOrigin" });
  const start = Date.now();
  const persist = ctx.persist ?? ctx.airline !== undefined;
  const airline: "Ryanair" | null = persist ? ctx.airline ?? "Ryanair" : null;
  const resume = ctx.resumeFromProgress ?? persist;

  const { insertStagingListings } = persist
    ? await import("../db/flight-listings")
    : { insertStagingListings: null as null };
  const { getClaimedDestinations, markDestinationCompleted, markDestinationFailed } =
    persist
      ? await import("../db/crawl-progress")
      : {
          getClaimedDestinations: null as null,
          markDestinationCompleted: null as null,
          markDestinationFailed: null as null,
        };

  const observedAtIso = ctx.observedAt.toISOString();
  const searchOrigin = originIata;
  const destinationFilter = ctx.destinationFilter?.length
    ? new Set(ctx.destinationFilter.map((c) => c.toUpperCase()))
    : null;

  const { getDestinationsForAirlineOrigin } = await import("../db/airline-routes");
  const routeDests = await getDestinationsForAirlineOrigin("Ryanair", originIata);
  const allowedDests = routeDests.size > 0 ? routeDests : null;

  const ctxLog = ctx.logger ?? stdoutLogger;

  let destinationsToScan: string[] | null;
  let requestsSkipped = 0;
  if (destinationFilter) {
    destinationsToScan = [];
    for (const d of destinationFilter) {
      if (allowedDests && !allowedDests.has(d)) {
        requestsSkipped += 1;
        continue;
      }
      destinationsToScan.push(d);
    }
  } else if (allowedDests) {
    destinationsToScan = [...allowedDests];
  } else {
    destinationsToScan = null;
  }

  if (resume && getClaimedDestinations && destinationsToScan) {
    const completed = await getClaimedDestinations({
      airline: airline!,
      originIata,
      dateFrom,
      dateTo,
    });
    if (completed.size > 0) {
      const before = destinationsToScan.length;
      destinationsToScan = destinationsToScan.filter(
        (d) => !completed.has(d.toUpperCase())
      );
      requestsSkipped += before - destinationsToScan.length;
      ctxLog.info("Resuming; skipping completed destinations", {
        origin: originIata,
        dateFrom,
        dateTo,
        completed: completed.size,
        remaining: destinationsToScan.length,
        runId: ctx.crawlRunId,
      });
    }
  }
  const total = destinationsToScan?.length ?? 1;

  ctxLog.info("Crawl plan ready", {
    origin: originIata,
    dateFrom,
    dateTo,
    destinations: total,
    calls: total,
    runId: ctx.crawlRunId,
  });

  const cache = new RunResponseCache();
  let requestsMade = 0;
  let cacheHits = 0;
  let rowsInserted = 0;

  const rows: FlightListingInput[] = [];
  const errors: CrawlResult["errors"] = [];
  const destinations = new Set<string>();

  const callDestinations =
    destinationsToScan ?? ["(any)"];
  const effectiveDateOut = dateFrom;
  const effectiveDateIn = dateTo;

  for (let i = 0; i < callDestinations.length; i++) {
    const destination = callDestinations[i]!;
    const callNo = i + 1;
    let isCacheHit = false;
    let durationMs: number | undefined;
    try {
      const key = rangeCacheKey({
        origin: originIata,
        dateFrom: effectiveDateOut,
        dateTo: effectiveDateIn,
        destination,
        adults: ctx.adults,
      });
      let cacheLookupHit = true;
      const callStart = Date.now();
      const res = await cache.getOrFetch(key, async () => {
        cacheLookupHit = false;
        requestsMade += 1;
        ctxLog.info("Calling Ryanair", {
          call: `${callNo}/${total}`,
          origin: originIata,
          destination,
          dateFrom: effectiveDateOut,
          dateTo: effectiveDateIn,
          runId: ctx.crawlRunId,
        });
        try {
          return await fetchRyanairAvailability(originIata, effectiveDateOut, {
            dateIn: effectiveDateIn,
            destination,
            adults: ctx.adults,
            roundTrip: false,
          });
        } finally {
          durationMs = Date.now() - callStart;
        }
      });
      isCacheHit = cacheLookupHit;
      if (isCacheHit) cacheHits += 1;
      const filterSet =
        destination === "(any)" ? destinationFilter : new Set([destination]);
      const parsed = parseRyanairTrips(
        res.trips ?? [],
        observedAtIso,
        "ryanair.com",
        searchOrigin,
        filterSet
      );
      rows.push(...parsed.rows);
      for (const d of parsed.destinationsScanned) destinations.add(d);

      const flightCount = (res.trips ?? []).reduce(
        (sum, t) =>
          sum +
          (t.dates ?? []).reduce(
            (s, d) => s + (d.flights?.length ?? 0),
            0
          ),
        0
      );

      if (persist && insertStagingListings && airline) {
        const insertedNow = parsed.rows.length > 0
          ? await insertStagingListings(airline, parsed.rows, ctx.crawlRunId)
          : 0;
        rowsInserted += insertedNow;
        if (markDestinationCompleted) {
          if (insertedNow > 0) {
            try {
              await markDestinationCompleted({
                airline,
                originIata,
                destinationIata: destination,
                dateFrom,
                dateTo,
                crawlRunId: ctx.crawlRunId,
                rowsInserted: insertedNow,
              });
            } catch (markErr) {
              ctxLog.warn("Failed to mark destination completed", {
                destination,
                error: (markErr as Error).message,
              });
            }
          } else {
            ctxLog.debug("Skipping markDestinationCompleted (insertedNow=0; would clobber prior success)", {
              destination,
              insertedNow,
            });
          }
        }
      }

      ctxLog.info("Ryanair call done", {
        call: `${callNo}/${total}`,
        origin: originIata,
        destination,
        dateFrom: effectiveDateOut,
        dateTo: effectiveDateIn,
        cacheHit: isCacheHit,
        durationMs: durationMs ?? Date.now() - callStart,
        flights: flightCount,
        rows: parsed.rows.length,
        rowsInsertedSoFar: rowsInserted,
        runId: ctx.crawlRunId,
      });

      ctx.onCall?.({
        index: callNo,
        total,
        origin: originIata,
        destination,
        dateFrom: effectiveDateOut,
        dateTo: effectiveDateIn,
        cacheHit: isCacheHit,
        durationMs,
        rowCount: parsed.rows.length,
        flightCount,
      });
    } catch (err) {
      const message = (err as Error).message;
      const isTou = err instanceof RyanairTermsOfUseError;
      errors.push({
        origin: originIata,
        date: `${effectiveDateOut}..${effectiveDateIn}`,
        message,
      });
      if (persist && markDestinationFailed && airline) {
        try {
          await markDestinationFailed({
            airline,
            originIata,
            destinationIata: destination,
            dateFrom,
            dateTo,
            crawlRunId: ctx.crawlRunId,
            error: message,
          });
        } catch (markErr) {
          ctxLog.warn("Failed to mark destination failed", {
            destination,
            error: (markErr as Error).message,
          });
        }
      }
      if (isTou) {
        ctxLog.error("Ryanair terms-of-use rejection; stopping fanout for this origin", {
          origin: originIata,
          destination,
          runId: ctx.crawlRunId,
        });
        return {
          rows,
          errors,
          destinationsScanned: destinations,
          requestsMade,
          cacheHits,
          requestsSkipped,
          rowsInserted,
        };
      }
      ctxLog.error("Ryanair call failed", {
        call: `${callNo}/${total}`,
        origin: originIata,
        destination,
        dateFrom: effectiveDateOut,
        dateTo: effectiveDateIn,
        error: message,
        runId: ctx.crawlRunId,
      });
    }
  }

  log.trace("<<< crawlRyanairForOrigin exit", { cls: "Ryanair", fn: "crawlRyanairForOrigin", waitMs: Date.now() - start });
  return {
    rows: persist ? [] : dedupeRyanairRows(rows),
    rowsInserted,
    errors,
    destinationsScanned: destinations,
    requestsMade,
    cacheHits,
    requestsSkipped,
  };
}

function dedupeRyanairRows(rows: FlightListingInput[]): FlightListingInput[] {
  log.trace(">>> dedupeRyanairRows enter", { cls: "Ryanair", fn: "dedupeRyanairRows" });
  const start = Date.now();
  const seen = new Map<string, FlightListingInput>();
  for (const row of rows) {
    const key = `${row.airline}|${row.flight_number}|${row.departure_datetime ?? ""}`;
    if (!seen.has(key)) seen.set(key, row);
  }
  log.trace("<<< dedupeRyanairRows exit", { cls: "Ryanair", fn: "dedupeRyanairRows", waitMs: Date.now() - start });
  return [...seen.values()];
}

function sanitizeSeatsLeft(value: number | null | undefined): number | null {
  log.trace(">>> sanitizeSeatsLeft enter", { cls: "Ryanair", fn: "sanitizeSeatsLeft" });
  const start = Date.now();
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) return null;
  if (value < 0) return null;
  if (value > 65535) return 65535;
  const result = Math.floor(value);
  log.trace("<<< sanitizeSeatsLeft exit", { cls: "Ryanair", fn: "sanitizeSeatsLeft", waitMs: Date.now() - start });
  return result;
}

async function loadRyanairSkipKeys(
  origins: string[],
  cooldownMs: number
): Promise<Set<string>> {
  log.trace(">>> loadRyanairSkipKeys enter", { cls: "Ryanair", fn: "loadRyanairSkipKeys" });
  const start = Date.now();
  if (cooldownMs <= 0) return new Set();
  if (origins.length === 0) return new Set();
  try {
    const { getRecentlySeenKeys } = await import("../db/flight-listings");
    log.trace("<<< loadRyanairSkipKeys exit", { cls: "Ryanair", fn: "loadRyanairSkipKeys", waitMs: Date.now() - start });
    return await getRecentlySeenKeys({
      airline: "Ryanair",
      sinceMinutes: Math.ceil(cooldownMs / 60_000),
    });
  } catch (err) {
    log.trace("<<< loadRyanairSkipKeys exit (error)", { cls: "Ryanair", fn: "loadRyanairSkipKeys", waitMs: Date.now() - start });
    return new Set();
  }
}

function daysBetween(fromIso: string, toIso: string): number {
  log.trace(">>> daysBetween enter", { cls: "Ryanair", fn: "daysBetween" });
  const start = Date.now();
  const from = new Date(`${fromIso}T00:00:00Z`).getTime();
  const to = new Date(`${toIso}T00:00:00Z`).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return -1;
  if (from > to) return -1;
  const result = Math.round((to - from) / (24 * 60 * 60 * 1000));
  log.trace("<<< daysBetween exit", { cls: "Ryanair", fn: "daysBetween", waitMs: Date.now() - start });
  return result;
}

export interface RyanairCrawlLogger {
  trace: (msg: string, meta?: Record<string, unknown>) => void;
  debug: (msg: string, meta?: Record<string, unknown>) => void;
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

const consoleLogger: RyanairCrawlLogger = {
  trace: (msg, meta) => console.log(`[trace] ${msg}`, meta ?? ""),
  debug: (msg, meta) => console.log(`[debug] ${msg}`, meta ?? ""),
  info: (msg, meta) => console.log(`[info]  ${msg}`, meta ?? ""),
  warn: (msg, meta) => console.warn(`[warn]  ${msg}`, meta ?? ""),
  error: (msg, meta) => console.error(`[error] ${msg}`, meta ?? ""),
};

export type CrawlRyanairRangeOptions = {
  crawlRunId: string;
  observedAt: Date;
  adults: number;
  dateFrom: string;
  dateTo: string;
  destinationFilter?: string[];
  requestDelayMs?: number;
  requestJitterMs?: number;
  cooldownMs?: number;
  logger?: RyanairCrawlLogger;
  persist?: boolean;
  resumeFromProgress?: boolean;
};

export type CrawlRyanairRangeResult = {
  origin: string;
  dateFrom: string;
  dateTo: string;
  flexDaysBefore: number;
  flexDaysAfter: number;
  destinations: string[];
  requestsMade: number;
  rowsInserted: number;
  errors: { origin: string; date: string; message: string }[];
  rows: FlightListingInput[];
};

export async function crawlRyanairRangeForOrigin(
  originIata: string,
  options: CrawlRyanairRangeOptions
): Promise<CrawlRyanairRangeResult> {
  log.trace(">>> crawlRyanairRangeForOrigin enter", { cls: "Ryanair", fn: "crawlRyanairRangeForOrigin" });
  const start = Date.now();
  const ctxLog = options.logger ?? consoleLogger;
  const observedAtIso = options.observedAt.toISOString();
  const persist = options.persist ?? true;
  const resume = options.resumeFromProgress ?? persist;

  const { insertStagingListings } = persist
    ? await import("../db/flight-listings")
    : { insertStagingListings: null as null };
  const { getClaimedDestinations, markDestinationCompleted, markDestinationFailed } =
    persist
      ? await import("../db/crawl-progress")
      : {
          getClaimedDestinations: null as null,
          markDestinationCompleted: null as null,
          markDestinationFailed: null as null,
        };

  const totalFlexDays = daysBetween(options.dateFrom, options.dateTo);
  if (totalFlexDays < 0) {
    throw new Error(
      `crawlRyanairRangeForOrigin: invalid dateFrom/dateTo (${options.dateFrom} .. ${options.dateTo})`
    );
  }
  const flexDaysBefore = 0;
  const flexDaysAfter = totalFlexDays;

  ctxLog.info("Resolving destinations", {
    origin: originIata,
    airline: "Ryanair",
    dateFrom: options.dateFrom,
    dateTo: options.dateTo,
    totalFlexDays,
  });

  const { getDestinationsWithNamesForAirlineOrigin } = await import(
    "../db/airline-routes"
  );
  const routeDestNames = await getDestinationsWithNamesForAirlineOrigin(
    "Ryanair",
    originIata
  );

  let destinations: string[];
  if (options.destinationFilter && options.destinationFilter.length > 0) {
    const filter = new Set(options.destinationFilter.map((c) => c.toUpperCase()));
    destinations = [...routeDestNames.keys()].filter((d) => filter.has(d));
    const missing = [...filter].filter((d) => !routeDestNames.has(d));
    if (missing.length > 0) {
      ctxLog.warn("Destination filter contains airports not in route table", {
        missing,
      });
    }
  } else if (routeDestNames.size > 0) {
    destinations = [...routeDestNames.keys()].sort();
  } else {
    throw new Error(
      `crawlRyanairRangeForOrigin: no destinations found in airline_routes for ${originIata} (Ryanair)`
    );
  }

  if (destinations.length === 0) {
    throw new Error(
      `crawlRyanairRangeForOrigin: zero destinations after filter for ${originIata}`
    );
  }

  if (resume && getClaimedDestinations) {
    const completed = await getClaimedDestinations({
      airline: "Ryanair",
      originIata,
      dateFrom: options.dateFrom,
      dateTo: options.dateTo,
    });
    if (completed.size > 0) {
      const before = destinations.length;
      destinations = destinations.filter(
        (d) => !completed.has(d.toUpperCase())
      );
      ctxLog.info("Resuming; skipping completed/in-progress destinations", {
        origin: originIata,
        dateFrom: options.dateFrom,
        dateTo: options.dateTo,
        completed: completed.size,
        remaining: destinations.length,
        runId: options.crawlRunId,
      });
      if (destinations.length === 0) {
        ctxLog.info("All destinations already completed", {
          origin: originIata,
          runId: options.crawlRunId,
        });
        return {
          origin: originIata,
          dateFrom: options.dateFrom,
          dateTo: options.dateTo,
          flexDaysBefore: 0,
          flexDaysAfter: totalFlexDays,
          destinations: [],
          requestsMade: 0,
          rowsInserted: 0,
          errors: [],
          rows: [],
        };
      }
      void before;
    }
  }

  ctxLog.info("Crawl plan ready", {
    origin: originIata,
    dateFrom: options.dateFrom,
    dateTo: options.dateTo,
    flexDaysBefore,
    flexDaysAfter,
    destinations: destinations.length,
    totalCalls: destinations.length,
    delayMs: options.requestDelayMs ?? CRAWL_CONFIG.ryanair.requestDelayMs,
    jitterMs: options.requestJitterMs ?? CRAWL_CONFIG.ryanair.requestJitterMs,
    runId: options.crawlRunId,
  });

  const rows: FlightListingInput[] = [];
  const errors: { origin: string; date: string; message: string }[] = [];
  let requestsMade = 0;
  let rowsInserted = 0;

  const total = destinations.length;
  let callIdx = 0;

  for (const destination of destinations) {
    callIdx += 1;
    const destinationName = routeDestNames.get(destination) ?? "";
    const callLog = {
      origin: originIata,
      destination,
      destinationName: destinationName || null,
      dateFrom: options.dateFrom,
      dateTo: options.dateTo,
      dateOut: options.dateFrom,
      flexDaysBefore,
      flexDaysAfter,
      call: `${callIdx}/${total}`,
      runId: options.crawlRunId,
    };

    ctxLog.info("Calling Ryanair farfnd", callLog);

    const callStart = Date.now();
    let farfndRes: RyanairCheapestPerDayResponse;
    try {
      requestsMade += 1;
      farfndRes = await fetchRyanairCheapestPerDay(originIata, destination, options.dateFrom);
    } catch (err) {
      const message = (err as Error).message;
      ctxLog.error("Ryanair farfnd call failed", {
        ...callLog,
        error: message,
      });
      errors.push({
        origin: originIata,
        date: destination,
        message,
      });
      if (persist && markDestinationFailed) {
        try {
          await markDestinationFailed({
            airline: "Ryanair",
            originIata,
            destinationIata: destination,
            dateFrom: options.dateFrom,
            dateTo: options.dateTo,
            crawlRunId: options.crawlRunId,
            error: message,
          });
        } catch (markErr) {
          ctxLog.warn("Failed to mark destination failed", {
            destination,
            error: (markErr as Error).message,
          });
        }
      }
      continue;
    }
    const callMs = Date.now() - callStart;

    const allFares = farfndRes.outbound.fares;
    const filteredFares = allFares.filter(
      (f) => f.day >= options.dateFrom && f.day <= options.dateTo
    );

    ctxLog.info("Ryanair farfnd call succeeded", {
      ...callLog,
      totalFaresInMonth: allFares.length,
      faresInRange: filteredFares.length,
      minFareDay: farfndRes.outbound.minFare?.day,
      minFarePrice: farfndRes.outbound.minFare?.price.value,
      maxFareDay: farfndRes.outbound.maxFare?.day,
      maxFarePrice: farfndRes.outbound.maxFare?.price.value,
      durationMs: callMs,
    });

    const parsedRows = parseRyanairCheapestPerDayFares(
      filteredFares,
      observedAtIso,
      "ryanair.com",
      originIata,
      destination
    );

    ctxLog.debug("Parsed fares for destination", {
      ...callLog,
      destination,
      faresInResponse: filteredFares.length,
      parsedRowCount: parsedRows.length,
    });

    rows.push(...parsedRows);

    if (persist && insertStagingListings) {
      const insertedNow = parsedRows.length > 0
        ? await insertStagingListings("Ryanair", parsedRows, options.crawlRunId)
        : 0;
      rowsInserted += insertedNow;

      ctxLog.debug("Inserted rows for destination", {
        ...callLog,
        destination,
        parsedRowCount: parsedRows.length,
        insertedNow,
      });
      if (markDestinationCompleted) {
        if (insertedNow > 0) {
          try {
            await markDestinationCompleted({
              airline: "Ryanair",
              originIata,
              destinationIata: destination,
              dateFrom: options.dateFrom,
              dateTo: options.dateTo,
              crawlRunId: options.crawlRunId,
              rowsInserted: insertedNow,
            });
          } catch (markErr) {
            ctxLog.warn("Failed to mark destination completed", {
              destination,
              error: (markErr as Error).message,
            });
          }
        } else {
          ctxLog.debug("Skipping markDestinationCompleted (insertedNow=0; would clobber prior success)", {
            destination,
            insertedNow,
          });
        }
      }
    }

    ctxLog.debug("Parsed trips", {
      ...callLog,
      rowsAdded: parsedRows.length,
    });
  }

  const deduped = persist ? [] : dedupeRyanairRows(rows);

  ctxLog.info("Crawl finished", {
    origin: originIata,
    dateFrom: options.dateFrom,
    dateTo: options.dateTo,
    destinations: destinations.length,
    requestsMade,
    rowsRaw: rows.length,
    rowsInserted,
    rowsInsertable: deduped.length,
    errors: errors.length,
    runId: options.crawlRunId,
  });

  log.trace("<<< crawlRyanairRangeForOrigin exit", { cls: "Ryanair", fn: "crawlRyanairRangeForOrigin", waitMs: Date.now() - start });
  return {
    origin: originIata,
    dateFrom: options.dateFrom,
    dateTo: options.dateTo,
    flexDaysBefore,
    flexDaysAfter,
    destinations,
    requestsMade,
    rowsInserted,
    errors,
    rows: deduped,
  };
}

export const ryanairCrawler: AirlineCrawler = {
  code: "FR",
  name: "Ryanair",
  defaultOrigins: RYANAIR_DEFAULT_BASES,
  crawl: crawlRyanair,
};
