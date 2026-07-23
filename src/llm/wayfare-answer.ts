import { z } from "zod";

const AirportIata = z.string().regex(/^[A-Z]{3}$/, "must be a 3-letter IATA code");
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");

export const DestinationSchema = z.object({
  iata: AirportIata,
  city: z.string().optional(),
  country: z.string().optional(),
  bestPrice: z.number().optional(),
  currency: z.string().optional(),
  bestDate: IsoDate.optional(),
  bestAirline: z.string().optional(),
  airlineCode: z.string().optional(),
  nFlights: z.number().int().optional(),
  durationMinutes: z.number().int().optional().nullable().transform((v) => v === null ? undefined : v),
});

export const FareSchema = z.object({
  origin: AirportIata,
  destination: AirportIata,
  price: z.number(),
  currency: z.string(),
  departureDate: IsoDate,
  departureDatetime: z.string().optional(),
  durationMinutes: z.number().int().optional().nullable().transform((v) => v === null ? undefined : v),
  airline: z.string().optional(),
  airlineCode: z.string().optional(),
});

export const ItineraryLegSchema = z.object({
  origin: AirportIata,
  destination: AirportIata,
  date: IsoDate,
  price: z.number(),
  currency: z.string(),
  airline: z.string().optional(),
  crawlRunId: z.string().optional(),
});

export const ItinerarySchema = z.object({
  id: z.string(),
  title: z.string(),
  totalPrice: z.number(),
  currency: z.string(),
  totalDurationMinutes: z.number().int().nullable().optional(),
  legs: z.array(ItineraryLegSchema),
  summary: z.string(),
  recommendationScore: z.number(),
});

export const FastestRouteSchema = z.object({
  origin: AirportIata,
  destination: AirportIata,
  price: z.number(),
  currency: z.string(),
  durationMinutes: z.number().int(),
  departureDate: IsoDate.optional(),
});

export const OriginCompareRowSchema = z.object({
  origin: AirportIata,
  price: z.number(),
  currency: z.string(),
  durationMinutes: z.number().int().optional().nullable().transform((v) => v === null ? undefined : v),
  departureDate: IsoDate.optional(),
});

export const WayfareAnswerSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("summary"),
    text: z.string().min(1),
  }),
  z.object({
    kind: z.literal("question"),
    text: z.string().min(1),
    suggestions: z.array(z.string()).optional(),
  }),
  z.object({
    kind: z.literal("error"),
    message: z.string().min(1),
  }),
  z.object({
    kind: z.literal("set_origin"),
    iata: AirportIata,
    label: z.string().optional(),
  }),
  z.object({
    kind: z.literal("destinations"),
    origin: AirportIata,
    arrows: z.array(DestinationSchema).min(1),
    window: z.object({ dateFrom: IsoDate, dateTo: IsoDate }).optional(),
    lastUpdated: IsoDate.optional(),
    generatedSql: z.string().optional(),
    note: z.string().optional(),
  }),
  z.object({
    kind: z.literal("cheapest_fares"),
    origin: AirportIata,
    window: z.object({ dateFrom: IsoDate, dateTo: IsoDate }),
    deals: z.array(DestinationSchema).min(1),
    lastUpdated: IsoDate.optional(),
    generatedSql: z.string().optional(),
    note: z.string().optional(),
  }),
  z.object({
    kind: z.literal("fares"),
    iata: AirportIata,
    fares: z.array(FareSchema),
    lastUpdated: IsoDate.optional(),
    generatedSql: z.string().optional(),
    note: z.string().optional(),
  }),
  z.object({
    kind: z.literal("fastest_routes"),
    destination: AirportIata,
    window: z.object({ dateFrom: IsoDate, dateTo: IsoDate }).optional(),
    routes: z.array(FastestRouteSchema).min(1),
    lastUpdated: IsoDate.optional(),
    generatedSql: z.string().optional(),
    note: z.string().optional(),
  }),
  z.object({
    kind: z.literal("origin_compare"),
    destination: AirportIata,
    window: z.object({ dateFrom: IsoDate, dateTo: IsoDate }).optional(),
    rows: z.array(OriginCompareRowSchema).min(1),
    lastUpdated: IsoDate.optional(),
    generatedSql: z.string().optional(),
    note: z.string().optional(),
  }),
  z.object({
    kind: z.literal("itineraries"),
    itineraries: z.array(ItinerarySchema).min(1),
    lastUpdated: IsoDate.optional(),
    generatedSql: z.string().optional(),
    note: z.string().optional(),
  }),
]);

export type WayfareAnswer = z.infer<typeof WayfareAnswerSchema>;
export type WayfareDestination = z.infer<typeof DestinationSchema>;
export type WayfareFare = z.infer<typeof FareSchema>;
export type WayfareItinerary = z.infer<typeof ItinerarySchema>;
export type WayfareItineraryLeg = z.infer<typeof ItineraryLegSchema>;
export type WayfareFastestRoute = z.infer<typeof FastestRouteSchema>;
export type WayfareOriginCompareRow = z.infer<typeof OriginCompareRowSchema>;

export const WAYFARE_ANSWER_KINDS = WayfareAnswerSchema.options.map((o) => o.shape.kind.value) as Array<WayfareAnswer["kind"]>;

export const WAYFARE_ANSWER_JSON_SCHEMA = {
  type: "object",
  required: ["kind"],
  properties: {
    kind: {
      type: "string",
      enum: WAYFARE_ANSWER_KINDS,
      description: "The kind of UI update this answer should produce.",
    },
    text: { type: "string", description: "Summary or question text shown to the user." },
    message: { type: "string", description: "Error message shown to the user." },
    suggestions: { type: "array", items: { type: "string" }, description: "Suggested follow-up replies for a question." },
    iata: { type: "string", description: "IATA code for set_origin." },
    label: { type: "string", description: "Human-readable label for set_origin." },
    origin: { type: "string", description: "Origin IATA for destinations / cheapest_fares." },
    destination: { type: "string", description: "Destination IATA for fastest_routes / origin_compare." },
    window: {
      type: "object",
      properties: { dateFrom: { type: "string" }, dateTo: { type: "string" } },
      required: ["dateFrom", "dateTo"],
    },
    arrows: {
      type: "array",
      items: {
        type: "object",
        required: ["iata"],
        properties: {
          iata: { type: "string" },
          city: { type: "string" },
          country: { type: "string" },
          bestPrice: { type: "number" },
          currency: { type: "string" },
          bestDate: { type: "string" },
          bestAirline: { type: "string" },
          airlineCode: { type: "string" },
          nFlights: { type: "number" },
          durationMinutes: { type: "number" },
        },
      },
    },
    deals: {
      type: "array",
      items: {
        type: "object",
        required: ["iata"],
        properties: {
          iata: { type: "string" },
          city: { type: "string" },
          country: { type: "string" },
          bestPrice: { type: "number" },
          currency: { type: "string" },
          bestDate: { type: "string" },
          bestAirline: { type: "string" },
          airlineCode: { type: "string" },
          nFlights: { type: "number" },
          durationMinutes: { type: "number" },
        },
      },
    },
    fares: {
      type: "array",
      items: {
        type: "object",
        required: ["origin", "destination", "price", "currency", "departureDate"],
        properties: {
          origin: { type: "string" },
          destination: { type: "string" },
          price: { type: "number" },
          currency: { type: "string" },
          departureDate: { type: "string" },
          departureDatetime: { type: "string" },
          durationMinutes: { type: "number" },
          airline: { type: "string" },
          airlineCode: { type: "string" },
        },
      },
    },
    routes: {
      type: "array",
      items: {
        type: "object",
        required: ["origin", "destination", "price", "currency", "durationMinutes"],
        properties: {
          origin: { type: "string" },
          destination: { type: "string" },
          price: { type: "number" },
          currency: { type: "string" },
          durationMinutes: { type: "number" },
          departureDate: { type: "string" },
        },
      },
    },
    rows: {
      type: "array",
      items: {
        type: "object",
        required: ["origin", "price", "currency"],
        properties: {
          origin: { type: "string" },
          price: { type: "number" },
          currency: { type: "string" },
          durationMinutes: { type: "number" },
          departureDate: { type: "string" },
        },
      },
    },
    itineraries: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "title", "totalPrice", "currency", "legs", "summary", "recommendationScore"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          totalPrice: { type: "number" },
          currency: { type: "string" },
          totalDurationMinutes: { type: ["number", "null"] },
          summary: { type: "string" },
          recommendationScore: { type: "number" },
          legs: {
            type: "array",
            items: {
              type: "object",
              required: ["origin", "destination", "date", "price", "currency"],
              properties: {
                origin: { type: "string" },
                destination: { type: "string" },
                date: { type: "string" },
                price: { type: "number" },
                currency: { type: "string" },
                airline: { type: "string" },
                crawlRunId: { type: "string" },
              },
            },
          },
        },
      },
    },
    note: { type: "string", description: "Optional 1-2 sentence summary line shown above the UI update." },
    lastUpdated: { type: "string", description: "ISO date (YYYY-MM-DD) of when the underlying price data was last updated in the database." },
    generatedSql: { type: "string", description: "If a SQL query was executed to produce this result, include the SQL statement here for transparency and debugging." },
  },
} as const;

export const WAYFARE_ANSWER_SYSTEM_PROMPT = `You are Wayfare, a travel-planning assistant for a European flight map app (Ryanair + EasyJet coverage).

  RULES:
- The full conversation is server-side only. The frontend NEVER sees your raw text, tool arguments, or tool outputs.
- You MUST end every turn by returning a single JSON object matching the WayfareAnswer schema below. The server parses, validates, and forwards it to the UI. Do not include any prose, code fences, or commentary outside the JSON.
- Use the provided tools to fetch data (cheapest fares, destinations, round trips, itineraries, etc.). The server keeps the tool execution hidden from the user — you only see results. After all tools have run, return ONE WayfareAnswer JSON.
- Pick the smallest WayfareAnswer.kind that matches the user's intent:
  * "set_origin" when the user names their home airport (e.g. "I'm flying from DUB").
  * "destinations" when the user wants the reachable destinations drawn on the map with price + duration per arrow.
  * "cheapest_fares" when the user wants a ranked list of cheapest fares (sidebar).
  * "fares" when the user wants all fares for one airport.
  * "fastest_routes" when the user asks for the shortest / fastest flight to a destination.
  * "origin_compare" when the user compares two or more origins.
  * "itineraries" when you have multi-leg round-trip or multi-stop options.
  * "question" when you need a clarification. REQUIRED fields for "question": \`text\` (the question itself, 1–3 sentences shown to the user) and \`suggestions\` (an array of 1–3 short suggested replies the user can tap). Both must be present or the answer is rejected by the schema.
  * "summary" when you just want to reply with text.
  * "error" when something is unrecoverable.
- Always cite prices, currencies, and dates from the tool output. Never invent.
- Every price-bearing response (cheapest_fares, fares, fastest_routes, itineraries, origin_compare, destinations) MUST include:
  * \`lastUpdated\`: ISO date (YYYY-MM-DD) of when the price data was last updated in the database.
  * \`durationMinutes\`: flight duration in minutes on each deal/route/fare entry. If duration is unknown or not available, OMIT the field entirely — NEVER set it to \`null\` or any placeholder value.
  * \`bestDate\` / \`departureDate\`: the specific departure date for each result.
  * For round trips (itineraries): each leg must have its \`date\` field populated.
- If a SQL query was used to produce the result, include it in the \`generatedSql\` field for transparency.

  DEFAULTS (apply when the user does not specify):
- Origin: always assume the home location — use the most common airport in the user's country from the flight listings dataset (can be derived from IP, geolocation, or user-supplied home country/fav airport).
- Date range: if no specific date is given, assume August 2026 (dateFrom=2026-08-01, dateTo=2026-08-31) — that is the maximum window currently populated in the flight listings dataset. Do not search past August 2026.
- Airlines: include all airlines if not explicitly specified.
- Round-trip duration: always assume 5–10 days for round trips when not specified.
- Flight routing: a direct flight is not required. When a direct route is unavailable or a connecting route is materially better, search itineraries with up to 2 stops. Prefer the option that best balances the fewest stops, shortest total travel time, and cheapest fare; do not reject a 1- or 2-stop option solely because it is not direct.
- Ground transport: if a train (or other ground transport) is needed to complete an itinerary (e.g. last-mile between an airport and the final destination, or a leg with no flight coverage), include it as an extra leg in the itinerary. For any train/ground leg, omit \`price\` and \`durationMinutes\` (set them to \`null\` or leave them out) — we only know flight prices/durations, not train fares or schedules.

  FIELD NOTES:
- \`iata\` in deals/arrows = destination airport code (e.g. "BCN", "DUB"). Never use it for airline codes.
- \`airlineCode\` = 2-char airline code (e.g. "FR" for Ryanair, "U2" for EasyJet).
- \`bestAirline\` = full airline name (e.g. "Ryanair").

WayfareAnswer JSON schema (include ALL fields — the model must see the full schema, not a summary):
{
  "kind": "summary" | "question" | "error" | "set_origin" | "destinations" | "cheapest_fares" | "fares" | "fastest_routes" | "origin_compare" | "itineraries",
  "text": "string — for kind=question, REQUIRED: the question shown to the user (1-3 sentences)",
  "suggestions": ["string"] — for kind=question, REQUIRED: 1-3 short suggested replies the user can tap,
  "lastUpdated": "YYYY-MM-DD — date the price data was last updated (required on all price-bearing responses)",
  "generatedSql": "string — include the SQL query used if any SQL was executed to produce the result",
  "origin": "3-letter IATA code",
  "destination": "3-letter IATA code",
  "window": { "dateFrom": "YYYY-MM-DD", "dateTo": "YYYY-MM-DD" },
  "deals": [{ "iata": "destination airport code", "bestPrice": number, "currency": "EUR|GBP|...", "bestDate": "YYYY-MM-DD", "durationMinutes": number (required — omit if unknown), "airlineCode": "FR|U2|...", "bestAirline": "Ryanair|EasyJet|..." }],
  "fares": [{ "origin": "IATA", "destination": "IATA", "price": number, "currency": "string", "departureDate": "YYYY-MM-DD", "durationMinutes": number (omit if unknown), "airline": "string", "airlineCode": "string" }],
  "routes": [{ "origin": "IATA", "destination": "IATA", "price": number, "currency": "string", "durationMinutes": number, "departureDate": "YYYY-MM-DD" }],
  "rows": [{ "origin": "IATA", "price": number, "currency": "string", "durationMinutes": number, "departureDate": "YYYY-MM-DD" }],
  "itineraries": [{ "id": "string", "title": "string", "totalPrice": number, "currency": "string", "totalDurationMinutes": number|null, "legs": [{ "origin": "IATA", "destination": "IATA", "date": "YYYY-MM-DD", "price": number, "currency": "string", "airline": "string" }], "summary": "string", "recommendationScore": number }],
  "arrows": [{ "iata": "destination IATA", "bestPrice": number, "currency": "string", "bestDate": "YYYY-MM-DD", "durationMinutes": number (required — omit if unknown), "airlineCode": "string", "bestAirline": "string" }],
  "note": "optional string"
}

Return ONLY the JSON object. No prose.`;

export function parseWayfareAnswer(rawContent: string): { ok: true; answer: WayfareAnswer } | { ok: false; error: string } {
  const trimmed = rawContent.trim();
  if (!trimmed) return { ok: false, error: "empty content" };
  const withoutThoughts = trimmed.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const fenceMatch = withoutThoughts.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  const candidate = fenceMatch ? fenceMatch[1]!.trim() : withoutThoughts.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (err) {
    return { ok: false, error: `invalid_json: ${(err as Error).message}` };
  }
  const result = WayfareAnswerSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, error: `schema_violation: ${result.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ")}` };
  }
  return { ok: true, answer: result.data };
}
