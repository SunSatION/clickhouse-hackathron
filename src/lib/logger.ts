type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  t: string;
  waitMs?: number;
  cls?: string;
  file: string;
  fn?: string;
  msg: string;
  depth: number;
  [key: string]: unknown;
}

const TRACE_PREFIX = ">>> ";
const EXIT_PREFIX = "<<< ";
const THREW_PREFIX = "!!! ";

let globalDepth = 0;

export function formatLog(entry: LogEntry): string {
  const tab = "  ".repeat(entry.depth);
  const parts = [`${tab}${entry.msg}`];
  parts.push(`[${entry.level.padEnd(5)}]`);
  if (entry.waitMs !== undefined) parts.push(`wait:${entry.waitMs}ms`);
  if (entry.cls) parts.push(`[${entry.cls}]`);
  parts.push(`(${entry.file})`);
  if (entry.fn) parts.push(`${entry.fn}()`);
  return parts.join(" ");
}

export function logger(file: string) {
  function log(level: LogLevel, msg: string, meta?: Record<string, unknown>): void {
    let depth = 0;
    if (msg.startsWith(TRACE_PREFIX)) {
      depth = globalDepth;
    } else if (msg.startsWith(EXIT_PREFIX) || msg.startsWith(THREW_PREFIX)) {
      depth = globalDepth;
      if (msg.startsWith(THREW_PREFIX)) {
        globalDepth = Math.max(0, globalDepth - 1);
      } else {
        globalDepth = Math.max(0, globalDepth - 1);
      }
    }
    const { cls: _cls, fn: _fn, waitMs, ...rest } = meta ?? {};
    const filteredMeta = Object.keys(rest).length > 0 ? rest : undefined;
    const entry: LogEntry = { level, t: new Date().toISOString(), file, msg, depth, ...meta };
    if (level === "error") console.error(formatLog(entry), filteredMeta ? JSON.stringify(filteredMeta) : "");
    else if (level === "warn") console.warn(formatLog(entry), filteredMeta ? JSON.stringify(filteredMeta) : "");
    else console.log(formatLog(entry), filteredMeta ? JSON.stringify(filteredMeta) : "");
  }

  return {
    trace(msg: string, meta?: Record<string, unknown>): void {
      const { cls: _cls, fn: _fn, waitMs, ...rest } = meta ?? {};
      const filteredMeta = Object.keys(rest).length > 0 ? rest : undefined;
      if (msg.startsWith(TRACE_PREFIX)) {
        const entry: LogEntry = { level: "trace", t: new Date().toISOString(), file, msg, depth: globalDepth, ...meta };
        console.log(formatLog(entry), filteredMeta ? JSON.stringify(filteredMeta) : "");
        globalDepth++;
      } else if (msg.startsWith(EXIT_PREFIX) || msg.startsWith(THREW_PREFIX)) {
        globalDepth = Math.max(0, globalDepth - 1);
        const entry: LogEntry = { level: "trace", t: new Date().toISOString(), file, msg, depth: globalDepth, ...meta };
        console.log(formatLog(entry), filteredMeta ? JSON.stringify(filteredMeta) : "");
      } else {
        const entry: LogEntry = { level: "trace", t: new Date().toISOString(), file, msg, depth: globalDepth, ...meta };
        console.log(formatLog(entry), filteredMeta ? JSON.stringify(filteredMeta) : "");
      }
    },
    debug(msg: string, meta?: Record<string, unknown>): void {
      log("debug", msg, meta);
    },
    info(msg: string, meta?: Record<string, unknown>): void {
      log("info", msg, meta);
    },
    warn(msg: string, meta?: Record<string, unknown>): void {
      log("warn", msg, meta);
    },
    error(msg: string, meta?: Record<string, unknown>): void {
      log("error", msg, meta);
    },
  };
}

export function traceFn<T extends (...args: unknown[]) => unknown>(
  fn: T,
  cls: string,
  fnName: string,
  file: string
): T {
  const log = logger(file);
  return (async (...args: Parameters<T>) => {
    log.trace(`>>> ${fnName} enter`, { cls, fn: fnName });
    const start = Date.now();
    try {
      const result = await fn(...args);
      log.trace(`<<< ${fnName} exit`, { cls, fn: fnName, waitMs: Date.now() - start });
      return result;
    } catch (err) {
      log.trace(`!!! ${fnName} threw`, { cls, fn: fnName, waitMs: Date.now() - start });
      throw err;
    }
  }) as T;
}
