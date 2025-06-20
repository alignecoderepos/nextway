/**
 * Simple in-memory cache middleware for the AI Gateway.
 *
 * The middleware caches non-streaming responses based on the
 * request body and path. Cached entries expire after a
 * configurable TTL (default: 1 minute).
 */

import type { MiddlewareHandler } from "hono";

interface CacheEntry {
  expires: number;
  body: string;
  status: number;
  headers: [string, string][];
  latencyMs: number;
  model?: string;
  provider?: string;
}

const store = new Map<string, CacheEntry>();

export interface CacheOptions {
  /** Time to live in milliseconds */
  ttl?: number;
}

/**
 * Creates the cache middleware.
 */
export function memoryCache(options: CacheOptions = {}): MiddlewareHandler {
  const ttl = options.ttl ?? 60_000; // default 60 seconds

  return async (c, next) => {
    const start = Date.now();
    // Clone the incoming request so that downstream handlers can still
    // consume the body.
    const clone = (c.req as any).raw?.clone
      ? (c.req as any).raw.clone()
      : (c.req as any).clone();
    const bodyText = await clone.text();
    const key = `${c.req.path}:${bodyText}`;

    const cached = store.get(key);
    if (cached && cached.expires > Date.now()) {
      c.res = new Response(cached.body, {
        status: cached.status,
        headers: cached.headers,
      });
      const latency = Date.now() - start;
      c.set("cache_status", "hit");
      c.set("cache_time_saved_ms", Math.max(0, cached.latencyMs - latency));
      if (cached.model) c.set("request_model", cached.model);
      if (cached.provider) c.set("target_provider", cached.provider);
      return;
    }

    await next();
    const latency = Date.now() - start;
    c.set("cache_status", "miss");
    c.set("cache_time_saved_ms", 0);

    // Only cache successful, non-streaming JSON responses
    const contentType = c.res.headers.get("content-type") || "";
    if (c.res.ok && !contentType.includes("text/event-stream")) {
      const resClone = c.res.clone();
      const resBody = await resClone.text();
      store.set(key, {
        expires: Date.now() + ttl,
        body: resBody,
        status: resClone.status,
        headers: Array.from(resClone.headers.entries()),
        latencyMs: latency,
        model: c.get("request_model"),
        provider: c.get("target_provider"),
      });
    }
  };
}

/** Clear all cached entries. Useful for tests. */
export function clearCache() {
  store.clear();
}
