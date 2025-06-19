/**
 * Simple in-memory cache middleware for the AI Gateway.
 *
 * The middleware caches non-streaming responses based on the
 * request body and path. Cached entries expire after a
 * configurable TTL (default: 1 minute).
 */

import type { MiddlewareHandler } from 'hono';

interface CacheEntry {
  expires: number;
  body: string;
  status: number;
  headers: [string, string][];
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
      return;
    }

    await next();

    // Only cache successful, non-streaming JSON responses
    const contentType = c.res.headers.get('content-type') || '';
    if (c.res.ok && !contentType.includes('text/event-stream')) {
      const resClone = c.res.clone();
      const resBody = await resClone.text();
      store.set(key, {
        expires: Date.now() + ttl,
        body: resBody,
        status: resClone.status,
        headers: Array.from(resClone.headers.entries()),
      });
    }
  };
}

/** Clear all cached entries. Useful for tests. */
export function clearCache() {
  store.clear();
}
