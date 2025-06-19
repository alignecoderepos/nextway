import { MiddlewareHandler } from 'hono';
import { randomUUID } from 'crypto';

export interface LoggerOptions {
  level?: 'debug' | 'info' | 'warn' | 'error';
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
}

/**
 * Create logging middleware for Hono.
 * Logs request metadata, body size, latency, and errors.
 */
export function gatewayLogger(options: LoggerOptions = {}): MiddlewareHandler {
  const logFn = options.log || ((entry: LogEntry) => {
    const { requestId, method, path, status, latencyMs } = entry;
    console.log(`[${requestId}] ${method} ${path} -> ${status} (${latencyMs}ms)`);
    if (options.level === 'debug') {
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

    c.res.headers.set('x-request-id', requestId);
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
    if (resClone.status >= 400) {
      entry.error = resText;
    }
    logFn(entry);
  };
}
