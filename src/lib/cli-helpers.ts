const IATA_RE = /^[A-Z]{3}$/;

export function parseIataList(input: string | undefined): string[] {
  if (!input) return [];
  return input
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => IATA_RE.test(s));
}

export function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function defaultDateToIso(): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}