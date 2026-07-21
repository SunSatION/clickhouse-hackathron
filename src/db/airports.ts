import { getClickHouse } from "./clickhouse.js";
import { logger } from "../lib/logger.js";

const log = logger("src/db/airports.ts");

export interface Airport {
  iata: string;
  name: string;
  city: string;
  country: string;
  region: string;
  lat: number;
  lon: number;
  type: string;
}

export interface AirportWithRouteCount extends Airport {
  originCount: number;
  destinationCount: number;
}

export interface FareRow {
  airline: string;
  airlineCode: string;
  flightNumber: string;
  origin: string;
  destination: string;
  departureDate: string;
  departureDatetime: string | null;
  arrivalDatetime: string | null;
  durationMinutes: number | null;
  currency: string;
  price: number;
  originalPrice: number | null;
  fareType: string;
  fareClass: string;
  seatsLeft: number | null;
  observedAt: string;
  crawlRunId: string;
}

export interface FareQuery {
  iata: string;
  airline?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

export interface CheapestRoute {
  origin: string;
  destination: string;
  price: number;
  currency: string;
  date: string;
  airline: string;
  durationMinutes: number | null;
}

export interface RoundTrip {
  origin: string;
  destination: string;
  outbound: CheapestRoute;
  return: CheapestRoute;
  tripDays: number;
  totalPrice: number;
  currency: string;
}

export interface RoundTripQuery {
  origin: string;
  destination: string;
  dateFrom: string;
  dateTo: string;
  minDays?: number;
  maxDays?: number;
}

export interface ItineraryLeg {
  origin: string;
  destination: string;
  date: string;
  price: number;
  currency: string;
  airline: string;
  durationMinutes: number | null;
}

export interface Itinerary {
  id: string;
  title: string;
  totalPrice: number;
  currency: string;
  totalDurationMinutes: number | null;
  legs: ItineraryLeg[];
  summary: string;
  recommendationScore: number;
}

export interface GenerateItineraryInput {
  prompt: string;
  homeIata: string;
  countries: string[];
  daysPerCountry: number;
  dateFrom: string;
  dateTo: string;
  preferredAirlines?: string[];
}

interface AirportRow {
  iata: string;
  name: string;
  city: string;
  country: string;
  region: string;
  lat: number;
  lon: number;
  type: string;
}

let byIata: Map<string, Airport> | null = null;
let allAirports: Airport[] | null = null;
let loadPromise: Promise<void> | null = null;

async function loadAllFromClickHouse(): Promise<void> {
  const ch = getClickHouse();
  const r = await ch.query({
    query: `
      SELECT iata, name, city, country, region, lat, lon, type
      FROM airports
      WHERE length(iata) = 3
    `,
    format: "JSONEachRow",
  });
  const rows = (await r.json()) as AirportRow[];
  byIata = new Map(rows.map((row) => [row.iata.toUpperCase(), {
    iata: row.iata.toUpperCase(),
    name: String(row.name ?? ""),
    city: String(row.city ?? ""),
    country: String(row.country ?? ""),
    region: String(row.region ?? ""),
    lat: Number(row.lat ?? 0),
    lon: Number(row.lon ?? 0),
    type: String(row.type ?? ""),
  }]));
  allAirports = Array.from(byIata.values()).sort((a, b) => a.iata.localeCompare(b.iata));
  log.info("Loaded airports from ClickHouse", { count: allAirports.length });
}

async function ensureLoaded(): Promise<void> {
  if (byIata) return;
  if (loadPromise) return loadPromise;
  loadPromise = loadAllFromClickHouse().finally(() => { loadPromise = null; });
  return loadPromise;
}

export async function listAllAirports(): Promise<Airport[]> {
  await ensureLoaded();
  return allAirports ?? [];
}

export async function getAirport(iata: string): Promise<Airport | null> {
  await ensureLoaded();
  return byIata?.get(iata.toUpperCase()) ?? null;
}

export async function searchAirports(query: string, limit = 25): Promise<Airport[]> {
  await ensureLoaded();
  const q = query.trim().toLowerCase();
  if (!q) return (allAirports ?? []).slice(0, limit);
  const hits: Airport[] = [];
  for (const a of allAirports ?? []) {
    if (
      a.iata.toLowerCase().includes(q) ||
      a.city.toLowerCase().includes(q) ||
      a.name.toLowerCase().includes(q) ||
      a.country.toLowerCase() === q
    ) {
      hits.push(a);
      if (hits.length >= limit) break;
    }
  }
  return hits;
}

const LONDON_IATAS = ["STN", "LGW", "LTN", "LHR", "LCY", "SEN"] as const;

export function londonAirports(): string[] {
  return [...LONDON_IATAS];
}

export async function listAirportsForAirline(
  airline: string = "Ryanair",
): Promise<AirportWithRouteCount[]> {
  const ch = getClickHouse();
  const r = await ch.query({
    query: `
      SELECT
        ar.origin_iata AS iata,
        any(a.name) AS name,
        any(a.city) AS city,
        any(a.country) AS country,
        any(a.region) AS region,
        any(a.lat) AS lat,
        any(a.lon) AS lon,
        any(a.type) AS type,
        countDistinct(ar.destination_iata) AS origin_count
      FROM flights.airline_routes_latest ar
      LEFT JOIN flights.airports a ON ar.origin_iata = a.iata
      WHERE ar.airline_code = {airline:String}
      GROUP BY ar.origin_iata
      ORDER BY origin_count DESC, ar.origin_iata ASC
    `,
    query_params: { airline: airline.toUpperCase() },
    format: "JSONEachRow",
  });
  const rows = (await r.json()) as Array<{
    iata: string; name: string; city: string; country: string; region: string;
    lat: number; lon: number; type: string; origin_count: string | number;
  }>;
  return rows.map((row) => ({
    iata: String(row.iata).toUpperCase(),
    name: String(row.name ?? ""),
    city: String(row.city ?? ""),
    country: String(row.country ?? ""),
    region: String(row.region ?? ""),
    lat: Number(row.lat ?? 0),
    lon: Number(row.lon ?? 0),
    type: String(row.type ?? ""),
    originCount: Number(row.origin_count ?? 0),
    destinationCount: 0,
  }));
}

export async function listAirportsWithRouteCounts(
  airline?: string,
): Promise<AirportWithRouteCount[]> {
  return listAirportsForAirline(airline ?? "Ryanair");
}

export function filterAirportsByAirline(
  airports: AirportWithRouteCount[],
): AirportWithRouteCount[] {
  return airports.filter((a) => a.originCount > 0);
}

export async function findCheapestRoutesBetween(
  pairs: Array<{ origin: string; destination: string }>,
  dateFrom: string,
  dateTo: string,
  preferredAirlines: string[] = [],
): Promise<Map<string, CheapestRoute>> {
  const ch = getClickHouse();
  const out = new Map<string, CheapestRoute>();
  if (pairs.length === 0) return out;

  const originCodes = Array.from(new Set(pairs.map((p) => p.origin)));
  const destCodes = Array.from(new Set(pairs.map((p) => p.destination)));
  const params: Record<string, unknown> = {
    origins: originCodes,
    dests: destCodes,
    dateFrom,
    dateTo,
  };
  const airlineFilter = preferredAirlines.length > 0 ? "AND airline_code IN {airlines:Array(String)}" : "";
  if (preferredAirlines.length > 0) params.airlines = preferredAirlines;

  const r = await ch.query({
    query: `
      SELECT
        origin_iata,
        destination_iata,
        min(price) AS min_price,
        any(currency) AS currency,
        min(departure_date) AS best_date,
        any(airline) AS airline,
        any(duration_minutes) AS duration_minutes
      FROM flight_listings_latest
      WHERE origin_iata IN {origins:Array(String)}
        AND destination_iata IN {dests:Array(String)}
        AND departure_date >= {dateFrom:Date}
        AND departure_date <= {dateTo:Date}
        ${airlineFilter}
      GROUP BY origin_iata, destination_iata
    `,
    query_params: params,
    format: "JSONEachRow",
  });
  const rows = (await r.json()) as Array<Record<string, unknown>>;
  for (const row of rows) {
    const origin = String(row.origin_iata).toUpperCase();
    const destination = String(row.destination_iata).toUpperCase();
    out.set(`${origin}|${destination}`, {
      origin,
      destination,
      price: Number(row.min_price ?? 0),
      currency: String(row.currency ?? "EUR"),
      date: String(row.best_date ?? "").slice(0, 10),
      airline: String(row.airline ?? ""),
      durationMinutes: row.duration_minutes != null ? Number(row.duration_minutes) : null,
    });
  }
  return out;
}

const FARE_BASE_QUERY = `
  SELECT
    airline,
    airline_code,
    flight_number,
    origin_iata,
    destination_iata,
    departure_date,
    departure_datetime,
    arrival_datetime,
    duration_minutes,
    currency,
    price,
    original_price,
    fare_type,
    fare_class,
    seats_left,
    latest_observed_at AS observed_at,
    crawl_run_id
  FROM flight_listings_latest
`;

export async function listFaresForAirport(q: FareQuery): Promise<FareRow[]> {
  const ch = getClickHouse();
  const params: Record<string, unknown> = { iata: q.iata.toUpperCase() };
  const conditions = ["(origin_iata = {iata:String} OR destination_iata = {iata:String})"];
  if (q.airline) {
    conditions.push("airline_code = {airline:String}");
    params.airline = q.airline;
  }
  if (q.dateFrom) {
    conditions.push("departure_date >= {dateFrom:Date}");
    params.dateFrom = q.dateFrom;
  }
  if (q.dateTo) {
    conditions.push("departure_date <= {dateTo:Date}");
    params.dateTo = q.dateTo;
  }
  const limit = Math.min(Math.max(1, q.limit ?? 200), 1000);
  params.limit = limit;
  const queryStr = `${FARE_BASE_QUERY}\n      WHERE ${conditions.join(" AND ")}\n      ORDER BY departure_date ASC\n      LIMIT {limit:UInt32}`;
  console.log("[listFaresForAirport]", queryStr, params);
  const r = await ch.query({
    query: queryStr,
    query_params: params,
    format: "JSONEachRow",
  });
  const rows = (await r.json()) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    airline: String(row.airline ?? ""),
    airlineCode: String(row.airline_code ?? ""),
    flightNumber: String(row.flight_number ?? ""),
    origin: String(row.origin_iata ?? "").toUpperCase(),
    destination: String(row.destination_iata ?? "").toUpperCase(),
    departureDate: String(row.departure_date ?? "").slice(0, 10),
    departureDatetime: row.departure_datetime ? String(row.departure_datetime) : null,
    arrivalDatetime: row.arrival_datetime ? String(row.arrival_datetime) : null,
    durationMinutes: row.duration_minutes != null ? Number(row.duration_minutes) : null,
    currency: String(row.currency ?? "EUR"),
    price: Number(row.price ?? 0),
    originalPrice: row.original_price != null ? Number(row.original_price) : null,
    fareType: String(row.fare_type ?? ""),
    fareClass: String(row.fare_class ?? ""),
    seatsLeft: row.seats_left != null ? Number(row.seats_left) : null,
    observedAt: String(row.observed_at ?? ""),
    crawlRunId: String(row.crawl_run_id ?? ""),
  }));
}

export interface AirportRoute {
  airline: string;
  airlineCode: string;
  originIata: string;
  destinationIata: string;
  lat: number;
  lon: number;
  city: string;
  country: string;
}

export async function getRoutesForAirport(iata: string): Promise<AirportRoute[]> {
  const ch = getClickHouse();
  const upperIata = iata.toUpperCase();
  const queryStr = `
    SELECT DISTINCT
      f.airline,
      f.airline_code,
      f.origin_iata,
      f.destination_iata,
      a.lat,
      a.lon,
      a.city,
      a.country
    FROM flights.flight_listings_latest f
    LEFT JOIN flights.airports a ON f.origin_iata = a.iata
    WHERE f.origin_iata = {iata:String}
  `;
  console.log("[getRoutesForAirport]", queryStr, { iata: upperIata });
  const r = await ch.query({
    query: queryStr,
    query_params: { iata: upperIata },
    format: "JSONEachRow",
  });
  const rows = (await r.json()) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    airline: String(row.airline ?? ""),
    airlineCode: String(row.airline_code ?? ""),
    originIata: String(row.origin_iata ?? "").toUpperCase(),
    destinationIata: String(row.destination_iata ?? "").toUpperCase(),
    lat: Number(row.lat ?? 0),
    lon: Number(row.lon ?? 0),
    city: String(row.city ?? ""),
    country: String(row.country ?? ""),
  }));
}

export async function findCheapestRoundTrip(q: RoundTripQuery): Promise<RoundTrip[]> {
  const ch = getClickHouse();
  const origin = q.origin.toUpperCase();
  const destination = q.destination.toUpperCase();
  const minDays = Math.max(1, Math.min(60, q.minDays ?? 3));
  const maxDays = Math.max(minDays, Math.min(60, q.maxDays ?? 14));

  const r = await ch.query({
    query: `
      SELECT
        origin_iata,
        destination_iata,
        departure_date,
        min(price) AS min_price,
        any(currency) AS currency,
        any(airline) AS airline,
        any(duration_minutes) AS duration_minutes
      FROM flight_listings
      WHERE (
            (origin_iata = {origin:String} AND destination_iata = {destination:String})
         OR (origin_iata = {destination:String} AND destination_iata = {origin:String})
          )
        AND departure_date >= {dateFrom:Date}
        AND departure_date <= {dateTo:Date}
      GROUP BY origin_iata, destination_iata, departure_date
      ORDER BY departure_date ASC
    `,
    query_params: { origin, destination, dateFrom: q.dateFrom, dateTo: q.dateTo },
    format: "JSONEachRow",
  });
  const rows = (await r.json()) as Array<Record<string, unknown>>;

  const outbound = rows.filter((r) => String(r.origin_iata).toUpperCase() === origin);
  const inbound = rows.filter((r) => String(r.origin_iata).toUpperCase() === destination);

  const results: RoundTrip[] = [];
  for (const ob of outbound) {
    const obDate = String(ob.departure_date ?? "").slice(0, 10);
    for (const ib of inbound) {
      const ibDate = String(ib.departure_date ?? "").slice(0, 10);
      if (!obDate || !ibDate || ibDate <= obDate) continue;
      const tripDays = Math.round(
        (new Date(ibDate + "T00:00:00Z").getTime() - new Date(obDate + "T00:00:00Z").getTime()) /
          86_400_000,
      );
      if (tripDays < minDays || tripDays > maxDays) continue;
      const totalPrice = Number(ob.min_price ?? 0) + Number(ib.min_price ?? 0);
      const currency = String(ob.currency ?? ib.currency ?? "EUR");
      results.push({
        origin,
        destination,
        outbound: {
          origin,
          destination,
          price: Number(ob.min_price ?? 0),
          currency,
          date: obDate,
          airline: String(ob.airline ?? ""),
          durationMinutes: ob.duration_minutes != null ? Number(ob.duration_minutes) : null,
        },
        return: {
          origin: destination,
          destination: origin,
          price: Number(ib.min_price ?? 0),
          currency,
          date: ibDate,
          airline: String(ib.airline ?? ""),
          durationMinutes: ib.duration_minutes != null ? Number(ib.duration_minutes) : null,
        },
        tripDays,
        totalPrice,
        currency,
      });
    }
  }

  results.sort((a, b) => a.totalPrice - b.totalPrice || a.tripDays - b.tripDays);
  return results;
}

const COUNTRY_TO_IATA: Record<string, string[]> = {
  malta: ["MLA"],
  italy: ["FCO", "CIA", "MXP", "BGY", "VCE", "VRN", "BLQ", "NAP", "CTA", "PMO", "TRS", "AOI", "BRI", "PSR", "CAG", "FLR", "PSA", "GOA", "REG", "TAR", "PEG"],
  france: ["CDG", "ORY", "BVA", "BOD", "MRS", "LYS", "NCE", "TLS", "NTE", "SXB", "LIL", "RNS", "BIA", "PGF", "AJA", "BIQ", "BES", "FNI"],
  spain: ["MAD", "BCN", "VLC", "SVQ", "AGP", "PMI", "IBZ", "ALC", "BIO", "ZAZ", "SDR", "VGO", "GRX", "LEI", "REU", "TFS", "TFN", "LPA", "FUE", "SPC", "VDE", "ACE", "GRO", "JCU"],
  portugal: ["LIS", "OPO", "FAO", "FNC", "PDL"],
  germany: ["FRA", "MUC", "BER", "HAM", "DUS", "CGN", "HAJ", "STR", "NUE", "LEJ", "DTM", "BRE", "HHN", "FMO", "PAD", "FKB"],
  netherlands: ["AMS", "RTM", "EIN", "GRQ"],
  belgium: ["BRU", "CRL", "OST"],
  united_kingdom: ["LHR", "LGW", "STN", "LTN", "MAN", "BHX", "EDI", "GLA", "BRS", "NCL", "LPL", "BFS", "DSA", "EXT", "EMA", "BOH", "SOU", "LCY"],
  ireland: ["DUB", "ORK", "SNN", "NOC", "KIR"],
  greece: ["ATH", "SKG", "HER", "CFU", "ZTH", "RHO", "KGS", "JTR", "JMK", "JNX", "CHQ", "MJT", "KVA", "LXS", "VOL"],
  austria: ["VIE", "SZG", "INN", "GRZ", "LNZ"],
  switzerland: ["ZRH", "GVA", "BSL"],
  sweden: ["ARN", "GOT", "MMX", "LPI"],
  norway: ["OSL", "BGO", "TRD", "SVG", "TOS", "BOO"],
  denmark: ["CPH", "BLL", "AAR"],
  finland: ["HEL", "TMP", "TKU", "OUL"],
  poland: ["WAW", "KRK", "GDN", "WRO", "KTW", "POZ", "RZE", "SZZ", "BZG", "LUZ"],
  czechia: ["PRG", "BRQ"],
  hungary: ["BUD", "DEB"],
  romania: ["OTP", "CLJ", "TSR", "IAS", "OMR", "SBZ"],
  bulgaria: ["SOF", "VAR", "BOJ", "PDV"],
  croatia: ["ZAG", "SPU", "DBV", "PUY", "ZAD", "RJK", "BWK"],
  slovenia: ["LJU"],
  slovakia: ["BTS", "KSC"],
  serbia: ["BEG", "INI"],
  montenegro: ["TGD", "TIV"],
  north_macedonia: ["SKP"],
  albania: ["TIA"],
  bosnia: ["SJJ", "OMO"],
  lithuania: ["VNO", "KUN", "PLQ"],
  latvia: ["RIX"],
  estonia: ["TLL"],
  iceland: ["KEF"],
  cyprus: ["LCA", "PFO"],
  malta_only: ["MLA"],
  morocco: ["CMN", "RAK", "AGA", "FEZ", "OUD", "TNG", "NDR", "TTU"],
  tunisia: ["TUN", "MIR", "DJE", "SFA"],
  egypt: ["CAI", "HRG", "SSH", "LXR", "ASW", "ALY"],
  turkey: ["IST", "SAW", "AYT", "ADB", "ESB", "ADA", "DLM", "BJV", "GZT", "TZX", "SZF"],
};

const COUNTRY_NAMES: Record<string, string> = {
  italy: "Italy",
  france: "France",
  spain: "Spain",
  portugal: "Portugal",
  germany: "Germany",
  netherlands: "Netherlands",
  belgium: "Belgium",
  united_kingdom: "United Kingdom",
  ireland: "Ireland",
  greece: "Greece",
  austria: "Austria",
  switzerland: "Switzerland",
  sweden: "Sweden",
  norway: "Norway",
  denmark: "Denmark",
  finland: "Finland",
  poland: "Poland",
  czechia: "Czech Republic",
  hungary: "Hungary",
  romania: "Romania",
  bulgaria: "Bulgaria",
  croatia: "Croatia",
  slovenia: "Slovenia",
  slovakia: "Slovakia",
  serbia: "Serbia",
  montenegro: "Montenegro",
  north_macedonia: "North Macedonia",
  albania: "Albania",
  bosnia: "Bosnia",
  lithuania: "Lithuania",
  latvia: "Latvia",
  estonia: "Estonia",
  iceland: "Iceland",
  cyprus: "Cyprus",
  malta: "Malta",
  morocco: "Morocco",
  tunisia: "Tunisia",
  egypt: "Egypt",
  turkey: "Turkey",
};

export function detectCountriesFromPrompt(prompt: string): string[] {
  const p = prompt.toLowerCase();
  const found: string[] = [];
  for (const [key, name] of Object.entries(COUNTRY_NAMES)) {
    const pat = key.replace(/_/g, " ");
    if (p.includes(pat) || p.includes(name.toLowerCase())) found.push(key);
  }
  return found;
}

export function airportsForCountry(country: string): string[] {
  return COUNTRY_TO_IATA[country] ?? [];
}