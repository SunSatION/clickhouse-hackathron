/**
 * Shared request pacer. All HTTP calls to external APIs must go through a
 * Pacer-guarded fetch to avoid being blocked.
 */

import { logger } from "./logger.js";

const FILE = "src/lib/paced-fetch.ts";
const log = logger(FILE);

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export class Pacer {
  private chain: Promise<void> = Promise.resolve();
  constructor(
    private minDelayMs: number,
    private jitterMs: number
  ) {}
  wait(): Promise<void> {
    const minDelay = this.minDelayMs;
    const jitter = this.jitterMs;
    this.chain = this.chain.then(
      () =>
        new Promise<void>((resolve) => {
          const delay =
            jitter > 0
              ? minDelay + Math.floor(Math.random() * jitter)
              : minDelay;
          if (delay <= 0) resolve();
          else setTimeout(() => resolve(), delay);
        })
    );
    return this.chain;
  }
}

export async function pacedFetch(
  pacer: Pacer,
  url: string,
  init?: RequestInit
): Promise<Response> {
  const reqStart = Date.now();
  const res = await fetch(url, init);
  const reqMs = Date.now() - reqStart;
  log.trace(`>>> HTTP ${(init?.method ?? "GET").padEnd(10)} ${url}`, { cls: "Pacer", fn: "pacedFetch", reqMs, url });
  log.trace(`<<< HTTP ${res.status} ${res.statusText} (${reqMs}ms) ${url}`, { cls: "Pacer", fn: "pacedFetch", reqMs, status: res.status, url });
  await pacer.wait();
  return res;
}

const GLOBAL_FETCH_DELAY_MS = intEnv("GLOBAL_FETCH_DELAY_MS", 2000);
const GLOBAL_FETCH_JITTER_MS = intEnv("GLOBAL_FETCH_JITTER_MS", 500);

const globalPacer = new Pacer(GLOBAL_FETCH_DELAY_MS, GLOBAL_FETCH_JITTER_MS);

const _originalFetch =
  typeof globalThis.fetch !== "undefined"
    ? globalThis.fetch.bind(globalThis)
    : undefined;

type PatchFlag = {
  __globalPaceInstalled?: boolean;
  __globalPacedFetch?: typeof fetch;
};

export async function globalPacedFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : String(input);
  const reqStart = Date.now();
  const res = await (_originalFetch ?? fetch)(input, init);
  const reqMs = Date.now() - reqStart;
  log.trace(`>>> HTTP ${(init?.method ?? "GET").padEnd(10)} ${url}`, { cls: "GlobalPacer", fn: "globalPacedFetch", reqMs, url });
  log.trace(`<<< HTTP ${res.status} ${res.statusText} (${reqMs}ms) ${url}`, { cls: "GlobalPacer", fn: "globalPacedFetch", reqMs, status: res.status, url });
  await globalPacer.wait();
  return res;
}

export function installGlobalPacing(): void {
  const g = globalThis as unknown as typeof globalThis & PatchFlag;
  if (g.__globalPaceInstalled) return;
  if (typeof g.fetch !== "function") return;
  g.__globalPacedFetch = g.fetch as typeof fetch;
  g.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    globalPacedFetch(input, init)) as typeof fetch;
  g.__globalPaceInstalled = true;
}
