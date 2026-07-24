import {
  findBestOneWay,
  findBestRoundTrip,
  findCheapestDestinations,
  findFastestFromAnyOrigin,
  type CalendarQuery,
  type ClampedDateRange,
  type DestinationDeal,
  type FastestQuery,
  type FastestRoute,
  type InspirationQuery,
  type OneWayCheapest,
  type RoundTripBundle,
  type RoundTripQuery,
} from "./fare-finder.js";

export interface NearMiss<T> {
  result: T;
  relaxedCriteria: string[];
}

export interface RelaxedSearchResult<T> {
  results: T[];
  nearMisses: NearMiss<T>[];
  window: ClampedDateRange;
  hadStrictMatch: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;
function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface RelaxationStep<Q> {
  criteria: string[];
  query: Q;
}

function ladderRoundTrip(q: RoundTripQuery): RelaxationStep<RoundTripQuery>[] {
  const steps: RelaxationStep<RoundTripQuery>[] = [];
  if (q.airlineCode) {
    steps.push({ criteria: ["airline"], query: { ...q, airlineCode: undefined } });
  }
  steps.push({
    criteria: ["dateWindow"],
    query: { ...q, dateFrom: shiftDate(q.dateFrom, -7), dateTo: shiftDate(q.dateTo, 7) },
  });
  if (q.airlineCode) {
    steps.push({
      criteria: ["airline", "dateWindow"],
      query: { ...q, airlineCode: undefined, dateFrom: shiftDate(q.dateFrom, -7), dateTo: shiftDate(q.dateTo, 7) },
    });
  }
  const baseMin = q.minDays ?? 3;
  const baseMax = q.maxDays ?? 14;
  if (q.minDays != null || q.maxDays != null) {
    steps.push({
      criteria: ["tripLength", "dateWindow"],
      query: {
        ...q,
        airlineCode: undefined,
        minDays: Math.max(1, baseMin - 2),
        maxDays: baseMax + 2,
        dateFrom: shiftDate(q.dateFrom, -7),
        dateTo: shiftDate(q.dateTo, 7),
      },
    });
  }
  steps.push({
    criteria: ["airline", "dateWindow", "tripLength"],
    query: {
      ...q,
      airlineCode: undefined,
      minDays: 1,
      maxDays: 60,
      dateFrom: shiftDate(q.dateFrom, -15),
      dateTo: shiftDate(q.dateTo, 15),
    },
  });
  return steps;
}

function ladderOneWay(q: CalendarQuery): RelaxationStep<CalendarQuery>[] {
  const steps: RelaxationStep<CalendarQuery>[] = [];
  if (q.airlineCode || q.airline) {
    steps.push({
      criteria: ["airline"],
      query: { ...q, airlineCode: undefined, airline: undefined },
    });
  }
  steps.push({
    criteria: ["dateWindow"],
    query: { ...q, dateFrom: shiftDate(q.dateFrom, -7), dateTo: shiftDate(q.dateTo, 7) },
  });
  if (q.airlineCode || q.airline) {
    steps.push({
      criteria: ["airline", "dateWindow"],
      query: {
        ...q,
        airlineCode: undefined,
        airline: undefined,
        dateFrom: shiftDate(q.dateFrom, -7),
        dateTo: shiftDate(q.dateTo, 7),
      },
    });
  }
  if (typeof q.maxPrice === "number" && q.maxPrice > 0) {
    steps.push({
      criteria: ["maxPrice", "dateWindow"],
      query: { ...q, maxPrice: undefined, dateFrom: shiftDate(q.dateFrom, -7), dateTo: shiftDate(q.dateTo, 7) },
    });
  }
  steps.push({
    criteria: ["airline", "maxPrice", "dateWindow"],
    query: {
      ...q,
      airlineCode: undefined,
      airline: undefined,
      maxPrice: undefined,
      dateFrom: shiftDate(q.dateFrom, -15),
      dateTo: shiftDate(q.dateTo, 15),
    },
  });
  return steps;
}

function ladderDestinations(q: InspirationQuery): RelaxationStep<InspirationQuery>[] {
  const steps: RelaxationStep<InspirationQuery>[] = [];
  if (typeof q.maxPrice === "number" && q.maxPrice > 0) {
    steps.push({ criteria: ["maxPrice"], query: { ...q, maxPrice: undefined } });
  }
  if (q.airlineCode || q.airline) {
    steps.push({
      criteria: ["airline"],
      query: { ...q, airlineCode: undefined, airline: undefined },
    });
  }
  steps.push({
    criteria: ["dateWindow"],
    query: { ...q, dateFrom: shiftDate(q.dateFrom, -7), dateTo: shiftDate(q.dateTo, 7) },
  });
  if (typeof q.maxPrice === "number" && q.maxPrice > 0) {
    steps.push({
      criteria: ["maxPrice", "dateWindow"],
      query: { ...q, maxPrice: undefined, dateFrom: shiftDate(q.dateFrom, -7), dateTo: shiftDate(q.dateTo, 7) },
    });
  }
  steps.push({
    criteria: ["airline", "maxPrice", "dateWindow"],
    query: {
      ...q,
      airlineCode: undefined,
      airline: undefined,
      maxPrice: undefined,
      dateFrom: shiftDate(q.dateFrom, -15),
      dateTo: shiftDate(q.dateTo, 15),
    },
  });
  return steps;
}

function ladderFastest(q: FastestQuery): RelaxationStep<FastestQuery>[] {
  const steps: RelaxationStep<FastestQuery>[] = [];
  steps.push({
    criteria: ["dateWindow"],
    query: { ...q, dateFrom: shiftDate(q.dateFrom, -7), dateTo: shiftDate(q.dateTo, 7) },
  });
  steps.push({
    criteria: ["dateWindow"],
    query: { ...q, dateFrom: shiftDate(q.dateFrom, -15), dateTo: shiftDate(q.dateTo, 15) },
  });
  if (q.airlineCode) {
    steps.push({
      criteria: ["airline", "dateWindow"],
      query: { ...q, airlineCode: undefined, dateFrom: shiftDate(q.dateFrom, -7), dateTo: shiftDate(q.dateTo, 7) },
    });
  }
  return steps;
}

export async function findRelaxedRoundTrip(q: RoundTripQuery): Promise<RelaxedSearchResult<RoundTripBundle>> {
  const strict = await findBestRoundTrip(q);
  if (strict.results.length > 0) {
    return { results: strict.results, nearMisses: [], window: strict.window, hadStrictMatch: true };
  }
  for (const step of ladderRoundTrip(q)) {
    const r = await findBestRoundTrip(step.query);
    if (r.results.length > 0) {
      return {
        results: [],
        nearMisses: r.results.map((result) => ({ result, relaxedCriteria: step.criteria })),
        window: r.window,
        hadStrictMatch: false,
      };
    }
  }
  return { results: [], nearMisses: [], window: strict.window, hadStrictMatch: false };
}

export async function findRelaxedOneWay(q: CalendarQuery): Promise<RelaxedSearchResult<OneWayCheapest>> {
  const strict = await findBestOneWay(q);
  if (strict.results.length > 0) {
    return { results: strict.results, nearMisses: [], window: strict.window, hadStrictMatch: true };
  }
  for (const step of ladderOneWay(q)) {
    const r = await findBestOneWay(step.query);
    if (r.results.length > 0) {
      return {
        results: [],
        nearMisses: r.results.map((result) => ({ result, relaxedCriteria: step.criteria })),
        window: r.window,
        hadStrictMatch: false,
      };
    }
  }
  return { results: [], nearMisses: [], window: strict.window, hadStrictMatch: false };
}

export async function findRelaxedDestinations(q: InspirationQuery): Promise<RelaxedSearchResult<DestinationDeal>> {
  const strict = await findCheapestDestinations(q);
  if (strict.results.length > 0) {
    return { results: strict.results, nearMisses: [], window: strict.window, hadStrictMatch: true };
  }
  for (const step of ladderDestinations(q)) {
    const r = await findCheapestDestinations(step.query);
    if (r.results.length > 0) {
      return {
        results: [],
        nearMisses: r.results.map((result) => ({ result, relaxedCriteria: step.criteria })),
        window: r.window,
        hadStrictMatch: false,
      };
    }
  }
  return { results: [], nearMisses: [], window: strict.window, hadStrictMatch: false };
}

export async function findRelaxedFastest(q: FastestQuery): Promise<RelaxedSearchResult<FastestRoute>> {
  const strict = await findFastestFromAnyOrigin(q);
  if (strict.results.length > 0) {
    return { results: strict.results, nearMisses: [], window: strict.window, hadStrictMatch: true };
  }
  for (const step of ladderFastest(q)) {
    const r = await findFastestFromAnyOrigin(step.query);
    if (r.results.length > 0) {
      return {
        results: [],
        nearMisses: r.results.map((result) => ({ result, relaxedCriteria: step.criteria })),
        window: r.window,
        hadStrictMatch: false,
      };
    }
  }
  return { results: [], nearMisses: [], window: strict.window, hadStrictMatch: false };
}

export const RELAXED_CRITERIA_LABELS: Record<string, string> = {
  airline: "airline filter",
  dateWindow: "date window",
  tripLength: "trip-length range",
  maxPrice: "max-price cap",
};

export function describeRelaxedCriteria(criteria: string[]): string {
  if (criteria.length === 0) return "";
  const parts = criteria.map((c) => RELAXED_CRITERIA_LABELS[c] ?? c);
  if (parts.length === 1) return parts[0]!;
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}
