import { MiddlewareHandler } from "hono";
import { randomUUID } from "crypto";
import type { GuardrailDetectionLog } from "../guardrails/index.js";

export interface LoggerOptions {
  level?: "debug" | "info" | "warn" | "error";
  /** Custom logging function */
  log?: (entry: LogEntry) => void;
}

export interface LogEntry {
  requestId: string;
  timestamp: string;
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  payloadSize: number;
  status?: number;
  responseSize?: number;
  latencyMs?: number;
  error?: unknown;
  guardrails?: GuardrailDetectionLog[];
  /** Model requested by the client */
  model?: string;
  /** Provider the request was routed to */
  provider?: string;
  /** Indicates whether the response came from cache or provider */
  servedFrom?: "cache" | "provider";
  /** Time saved when served from cache */
  cacheTimeSavedMs?: number;
}

/**
 * Create logging middleware for Hono.
 * Logs request metadata, body size, latency, and errors.
 */
export function gatewayLogger(options: LoggerOptions = {}): MiddlewareHandler {
  const logFn =
    options.log ||
    ((entry: LogEntry) => {
      const { requestId, method, path, status, latencyMs } = entry;
      console.log(
        `[${requestId}] ${method} ${path} -> ${status} (${latencyMs}ms)`,
      );
      if (options.level === "debug") {
        console.debug(JSON.stringify(entry, null, 2));
      }
    });

  return async (c, next) => {
    const start = Date.now();
    const requestId = randomUUID();
    const url = new URL(c.req.url);
    const headers: Record<string, string> = {};
    for (const [k, v] of c.req.raw.headers.entries()) {
      headers[k.toLowerCase()] = v;
    }

    // Clone request body to compute size without consuming it
    const clone = (c.req as any).raw?.clone
      ? (c.req as any).raw.clone()
      : (c.req as any).clone();
    const bodyText = await clone.text();

    const entry: LogEntry = {
      requestId,
      timestamp: new Date().toISOString(),
      method: c.req.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      headers,
      payloadSize: bodyText.length,
    };

    c.res.headers.set("x-request-id", requestId);
    try {
      await next();
    } catch (err) {
      entry.error = err instanceof Error ? err.message : err;
      entry.status = 500;
      entry.latencyMs = Date.now() - start;
      logFn(entry);
      throw err;
    }

    const resClone = c.res.clone();
    const resText = await resClone.text();
    entry.status = resClone.status;
    entry.responseSize = resText.length;
    entry.latencyMs = Date.now() - start;
    entry.model = c.get("request_model");
    entry.provider = c.get("target_provider");
    const cacheStatus = c.get("cache_status") as "hit" | "miss" | undefined;
    entry.servedFrom = cacheStatus === "hit" ? "cache" : "provider";
    const saved = c.get("cache_time_saved_ms");
    if (typeof saved === "number") {
      entry.cacheTimeSavedMs = saved;
    }
    const detections = c.get("guardrail_detections") as
      | GuardrailDetectionLog[]
      | undefined;
    if (detections && detections.length > 0) {
      entry.guardrails = detections;
    }
    if (resClone.status >= 400) {
      entry.error = resText;
    }
    logFn(entry);
  };
}
