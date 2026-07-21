import { emitHistogram, emitLog, emitSpan, isOtelEnabled } from "./emitter.js";
import { nowNs } from "./ids.js";
import { installGlobalPacing, globalPacedFetch } from "../lib/paced-fetch.js";

type OTelPatchFlag = {
  __otelFetchInstalled?: boolean;
  __otelOriginalFetch?: typeof fetch;
};

function attrsFor(input: RequestInfo | URL, init?: RequestInit): { method: string; url: string } {
  let method = "GET";
  let url = "";
  if (typeof input === "string") url = input;
  else if (input instanceof URL) url = input.toString();
  else if (input instanceof Request) {
    url = input.url;
    method = input.method;
  }
  if (init?.method) method = init.method.toUpperCase();
  return { method: method.toUpperCase(), url };
}

function shortPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function nowMs(deltaNs: bigint): number {
  return Number(deltaNs) / 1_000_000;
}

function originalFetch(): typeof fetch {
  return (
    (globalThis as unknown as OTelPatchFlag).__otelOriginalFetch ??
    globalThis.fetch
  ).bind(globalThis);
}

export async function instrumentedFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  if (!isOtelEnabled()) return await globalPacedFetch(input as never, init);
  const { method, url } = attrsFor(input, init);
  const start = nowNs();
  try {
    const res = await globalPacedFetch(input as never, init);
    const end = nowNs();
    const attrs: Record<string, string> = {
      "http.request.method": method,
      "url.full": url,
      "http.response.status_code": String(res.status),
    };
    emitSpan({
      name: `HTTP ${method} ${shortPath(url)}`,
      kind: "CLIENT",
      startNs: start,
      endNs: end,
      statusCode: res.status >= 400 ? "ERROR" : "OK",
      attributes: attrs,
    });
    emitLog({
      severity: res.status >= 500 ? "ERROR" : res.status >= 400 ? "WARN" : "INFO",
      body: `${method} ${url} -> ${res.status}`,
      attributes: { ...attrs, "http.response.latency_ms": String(nowMs(end - start)) },
      eventName: "http.request",
    });
    emitHistogram({
      name: "http.client.request.duration",
      description: "Outbound HTTP request duration",
      unit: "ms",
      value: nowMs(end - start),
      attributes: attrs,
    });
    return res;
  } catch (err) {
    const end = nowNs();
    const error = err as Error;
    const attrs: Record<string, string> = {
      "http.request.method": method,
      "url.full": url,
      "error.type": error?.name ?? "Error",
      "error.message": error?.message ?? String(err),
    };
    emitSpan({
      name: `HTTP ${method} ${shortPath(url)} (failed)`,
      kind: "CLIENT",
      startNs: start,
      endNs: end,
      statusCode: "ERROR",
      statusMessage: error?.message ?? String(err),
      attributes: attrs,
    });
    emitLog({
      severity: "ERROR",
      body: `${method} ${url} failed: ${error?.message ?? err}`,
      attributes: attrs,
      eventName: "http.request.error",
    });
    throw err;
  }
}

export function installFetchInstrumentation(): void {
  installGlobalPacing();
  const g = globalThis as unknown as { fetch: typeof fetch } & OTelPatchFlag;
  if (g.__otelFetchInstalled) return;
  if (typeof g.fetch !== "function") return;
  g.__otelOriginalFetch = g.fetch as typeof fetch;
  g.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    instrumentedFetch(input, init)) as typeof fetch;
  g.__otelFetchInstalled = true;
}
