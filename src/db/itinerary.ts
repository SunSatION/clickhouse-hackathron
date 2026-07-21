import { randomUUID } from "node:crypto";

import {
  type Airport,
  airportsForCountry,
  detectCountriesFromPrompt,
  findCheapestRoutesBetween,
  type Itinerary,
  type ItineraryLeg,
  listAllAirports,
} from "./airports.js";
import { logger } from "../lib/logger.js";

const log = logger("src/db/itinerary.ts");

export interface ItineraryRequest {
  prompt?: string;
  homeIata: string;
  dateFrom: string;
  dateTo: string;
  daysPerCountry?: number;
  preferredAirlines?: string[];
  maxItineraries?: number;
  destinations?: string[];
}

interface CountryStop {
  country: string;
  airport: string;
}

function pickHomeAirport(homeIata: string): Airport | null {
  const all = listAllAirports();
  return all.find((a) => a.iata === homeIata.toUpperCase()) ?? null;
}

function pickCountryAirport(country: string): string | null {
  const iatas = airportsForCountry(country);
  if (iatas.length === 0) return null;
  return iatas[0] ?? null;
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function distributeDates(totalDays: number, segments: number, start: string): string[] {
  const out: string[] = [];
  const per = Math.max(1, Math.floor(totalDays / Math.max(1, segments + 1)));
  for (let i = 0; i < segments; i++) {
    out.push(addDays(start, per * (i + 1)));
  }
  return out;
}

export async function generateItineraries(req: ItineraryRequest): Promise<Itinerary[]> {
  const daysPerCountry = Math.max(1, Math.min(30, req.daysPerCountry ?? 3));
  const maxItineraries = Math.max(1, Math.min(8, req.maxItineraries ?? 4));
  const homeIata = req.homeIata.toUpperCase();

  const explicit = (req.destinations ?? []).map((s) => s.toUpperCase()).filter((s) => /^[A-Z]{3}$/.test(s));
  const explicitUnique = Array.from(new Set(explicit)).filter((d) => d !== homeIata);

  let stops: CountryStop[] = [];
  let promptNote = "";
  let stopCountries: string[] = [];

  if (explicitUnique.length > 0) {
    stops = explicitUnique.map((iata) => ({ country: iata, airport: iata }));
    stopCountries = explicitUnique;
  } else {
    const detected = detectCountriesFromPrompt(req.prompt ?? "");
    if (detected.length === 0) {
      return [
        {
          id: randomUUID(),
          title: "No destinations",
          totalPrice: 0,
          currency: "EUR",
          totalDurationMinutes: null,
          legs: [],
          summary:
            "Pick some airports on the map or describe your trip in the chat (e.g. 'France, Spain, Italy').",
          recommendationScore: 0,
        },
      ];
    }
    for (const country of detected) {
      const ap = pickCountryAirport(country);
      if (ap) stops.push({ country, airport: ap });
    }
    if (stops.length === 0) {
      return [
        {
          id: randomUUID(),
          title: "No airports found",
          totalPrice: 0,
          currency: "EUR",
          totalDurationMinutes: null,
          legs: [],
          summary: `I found the countries (${detected.join(", ")}) but couldn't match them to known airports.`,
          recommendationScore: 0,
        },
      ];
    }
    stopCountries = detected;
    promptNote = `Detected countries: ${detected.join(", ")}. `;
  }

  const home = pickHomeAirport(homeIata);
  if (!home) {
    return [
      {
        id: randomUUID(),
        title: `Unknown home airport ${homeIata}`,
        totalPrice: 0,
        currency: "EUR",
        totalDurationMinutes: null,
        legs: [],
        summary: `Home IATA ${homeIata} was not found in the airport dataset.`,
        recommendationScore: 0,
      },
    ];
  }

  if (stops.length > 6) {
    stops = stops.slice(0, 6);
    promptNote += `Capped at 6 destinations (you picked ${explicitUnique.length}). `;
  }

  const sequences: string[][] = permute(stops.map((s) => s.airport)).slice(0, maxItineraries) as string[][];
  const allPairs: Array<{ origin: string; destination: string }> = [];
  for (const seq of sequences) {
    const path: string[] = [homeIata, ...seq, homeIata];
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      if (!a || !b) continue;
      allPairs.push({ origin: a, destination: b });
    }
  }

  const cheapest = await findCheapestRoutesBetween(
    allPairs,
    req.dateFrom,
    req.dateTo,
    req.preferredAirlines ?? [],
  );

  const totalDays = daysBetween(req.dateFrom, req.dateTo);
  const itineraries: Itinerary[] = [];
  for (let s = 0; s < sequences.length; s++) {
    const seq = sequences[s];
    if (!seq) continue;
    const legs: ItineraryLeg[] = [];
    const path = [homeIata, ...seq, homeIata];
    const legDates = distributeDates(totalDays, path.length - 1, req.dateFrom);
    let totalPrice = 0;
    let currency = "EUR";
    let totalDuration = 0;
    let foundLeg = false;
    for (let i = 0; i < path.length - 1; i++) {
      const origin = path[i];
      const destination = path[i + 1];
      if (!origin || !destination) continue;
      const hit = cheapest.get(`${origin}|${destination}`);
      const date = legDates[i] ?? req.dateFrom;
      if (hit) {
        legs.push({
          origin,
          destination,
          date: hit.date ?? date,
          price: hit.price,
          currency: hit.currency,
          airline: hit.airline,
          durationMinutes: hit.durationMinutes,
        });
        totalPrice += hit.price;
        currency = hit.currency || currency;
        totalDuration += hit.durationMinutes ?? 0;
        foundLeg = true;
      } else {
        legs.push({
          origin,
          destination,
          date,
          price: 0,
          currency,
          airline: "—",
          durationMinutes: null,
        });
      }
    }
    const score = scoreItinerary(legs, foundLeg, stops.length, req.preferredAirlines ?? []);
    itineraries.push({
      id: randomUUID(),
      title: itineraryTitle(seq, stops),
      totalPrice: round2(totalPrice),
      currency,
      totalDurationMinutes: totalDuration > 0 ? totalDuration : null,
      legs,
      summary: itinerarySummary(legs, foundLeg, stopCountries, daysPerCountry, promptNote),
      recommendationScore: score,
    });
  }

  itineraries.sort((a, b) => {
    const aComplete = a.legs.every((l) => l.price > 0);
    const bComplete = b.legs.every((l) => l.price > 0);
    if (aComplete !== bComplete) return aComplete ? -1 : 1;
    return a.totalPrice - b.totalPrice;
  });

  log.info("Generated itineraries", { count: itineraries.length, countries: stopCountries });
  return itineraries;
}

function itineraryTitle(seq: string[], stops: CountryStop[]): string {
  const labels = seq.map((iata) => {
    const stop = stops.find((s) => s.airport === iata);
    return stop ? stop.country : iata;
  });
  return labels.join(" → ");
}

function itinerarySummary(
  legs: ItineraryLeg[],
  foundLeg: boolean,
  countries: string[],
  days: number,
  note: string,
): string {
  const missing = legs.filter((l) => l.price === 0).map((l) => `${l.origin}→${l.destination}`);
  const covered = countries.filter(() => foundLeg);
  const prefix = note ? `${note}` : "";
  if (missing.length === 0) {
    return `${prefix}Found pricing for ${legs.length} legs across ${covered.length} stop${covered.length === 1 ? "" : "s"}, ~${days} days each.`;
  }
  return `${prefix}Found pricing for ${legs.length - missing.length}/${legs.length} legs. Missing data: ${missing.join(", ")}. Try expanding the date range or request a crawl.`;
}

function scoreItinerary(
  legs: ItineraryLeg[],
  foundLeg: boolean,
  countries: number,
  preferred: string[],
): number {
  let score = 0;
  const pricedLegs = legs.filter((l) => l.price > 0).length;
  score += (pricedLegs / Math.max(1, legs.length)) * 60;
  score += Math.min(40, countries * 8);
  if (preferred.length > 0) {
    const matched = legs.filter((l) => preferred.includes(l.airline)).length;
    score += (matched / Math.max(1, legs.length)) * 20;
  }
  if (!foundLeg) score = 0;
  return Math.round(score);
}

function permute<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items.slice()];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    const head = items[i];
    if (head === undefined) continue;
    const rest = items.slice(0, i).concat(items.slice(i + 1));
    for (const sub of permute(rest)) {
      out.push([head, ...sub]);
    }
  }
  return out;
}

function daysBetween(a: string, b: string): number {
  const d1 = new Date(a + "T00:00:00Z").getTime();
  const d2 = new Date(b + "T00:00:00Z").getTime();
  return Math.max(1, Math.round((d2 - d1) / 86_400_000));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface FavoriteTrip {
  id: string;
  itineraryId: string;
  title: string;
  totalPrice: number;
  currency: string;
  legs: ItineraryLeg[];
  savedAt: string;
}

const FAVORITES: FavoriteTrip[] = [];

export function listFavorites(): FavoriteTrip[] {
  return FAVORITES.slice().sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export function saveFavorite(it: Itinerary): FavoriteTrip {
  const fav: FavoriteTrip = {
    id: randomUUID(),
    itineraryId: it.id,
    title: it.title,
    totalPrice: it.totalPrice,
    currency: it.currency,
    legs: it.legs,
    savedAt: new Date().toISOString(),
  };
  FAVORITES.unshift(fav);
  return fav;
}

export function removeFavorite(id: string): boolean {
  const idx = FAVORITES.findIndex((f) => f.id === id);
  if (idx === -1) return false;
  FAVORITES.splice(idx, 1);
  return true;
}
