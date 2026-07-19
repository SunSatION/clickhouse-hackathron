import { randomBytes } from "node:crypto";

/**
 * Generates a 16-byte W3C-style trace id (32 hex chars).
 * If `seed` is provided the id is deterministic — used so that the
 * crawl_run_id (a UUID) becomes the trace id, giving us perfect
 * correlation between flight_listings.crawl_run_id, crawl_progress.*,
 * and the otel_* tables ClickStack reads from.
 */
export function newTraceId(seed?: string): string {
  if (seed) return seed.replace(/-/g, "").toLowerCase().padEnd(32, "0").slice(0, 32);
  return randomBytes(16).toString("hex");
}

export function newSpanId(seed?: string): string {
  if (seed) {
    let h = "";
    for (const c of seed) h += (c.charCodeAt(0) & 0xf).toString(16);
    return (h + "0000000000000000").slice(0, 16);
  }
  return randomBytes(8).toString("hex");
}

export function nowNs(): bigint {
  return BigInt(Date.now()) * 1_000_000n + BigInt(process.hrtime.bigint() % 1_000_000n);
}

export function nowMicros(): number {
  return Date.now() * 1000;
}

export function nanoDiff(start: bigint, end: bigint = nowNs()): number {
  return Number(end - start);
}
