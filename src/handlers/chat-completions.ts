/**
 * Chat completions request handler.
 * Mount this router on `/v1/chat/completions`.
 */
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { memoryCache } from "../middleware/cache/index.js";
import { guardrails } from "../middleware/guardrails/index.js";
import { getConfig, getProviderForModel } from "../config.js";
import { OpenAIProvider } from "../providers/openai.js";
import { AnthropicProvider } from "../providers/anthropic.js";
import type { OpenAIRequest } from "../providers/openai.js";

interface RateLimitEntry {
  tokens: number;
  lastRefill: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

class RateLimiter {
  private refillRate: number;
  constructor(private maxTokens: number) {
    this.refillRate = maxTokens;
  }

  isAllowed(key: string): boolean {
    const now = Date.now();
    let entry = rateLimitStore.get(key);

    if (!entry) {
      entry = { tokens: this.maxTokens - 1, lastRefill: now };
      rateLimitStore.set(key, entry);
      return true;
    }

    const timePassed = now - entry.lastRefill;
    const tokensToAdd = Math.floor(
      (timePassed / (60 * 1000)) * this.refillRate,
    );

    if (tokensToAdd > 0) {
      entry.tokens = Math.min(this.maxTokens, entry.tokens + tokensToAdd);
      entry.lastRefill = now;
    }

    if (entry.tokens > 0) {
      entry.tokens--;
      return true;
    }

    return false;
  }
}

function createErrorResponse(
  c: any,
  message: string,
  type = "gateway_error",
  code = "UNKNOWN",
  status = 500,
) {
  return c.json(
    {
      error: {
        message,
        type,
        code,
      },
    },
    status,
  );
}

export function chatCompletionsHandler(): Hono {
  const config = getConfig();
  const rateLimiter = new RateLimiter(config.rate_limits.per_minute);
  const openaiProvider = new OpenAIProvider();
  const anthropicProvider = new AnthropicProvider();

  const router = new Hono();

  // rate limiting middleware
  router.use(async (c, next) => {
    const authHeader = c.req.header("authorization");
    const key = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : c.req.header("x-forwarded-for") ||
        c.req.header("x-real-ip") ||
        "unknown";

    if (!rateLimiter.isAllowed(key)) {
      return createErrorResponse(
        c,
        "Rate limit exceeded",
        "rate_limit_error",
        "RATE_LIMIT_EXCEEDED",
        429,
      );
    }

    await next();
  });

  router.use(memoryCache());
  router.use(guardrails());

  router.post("/", async (c) => {
    try {
      const request: OpenAIRequest = await c.req.json();

      if (!request.model) {
        return createErrorResponse(
          c,
          "Model is required",
          "invalid_request_error",
          "MISSING_MODEL",
          400,
        );
      }

      if (!request.messages || !Array.isArray(request.messages)) {
        return createErrorResponse(
          c,
          "Messages array is required",
          "invalid_request_error",
          "MISSING_MESSAGES",
          400,
        );
      }

      const provider = getProviderForModel(request.model);
      c.set("request_model", request.model);
      c.set("target_provider", provider);

      if (config.logging.level === "debug") {
        console.log(`Routing model ${request.model} to provider: ${provider}`);
      }

      let response: Response;

      if (provider === "openai") {
        response = await openaiProvider.chatCompletions(request);
      } else {
        response = await anthropicProvider.chatCompletions(request);
      }

      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`Provider error (${response.status}):`, errorBody);

        return createErrorResponse(
          c,
          `Provider returned error: ${response.status}`,
          "provider_error",
          "PROVIDER_ERROR",
          response.status,
        );
      }

      const responseData = await response.json();
      return c.json(responseData, response.status as ContentfulStatusCode);
    } catch (error) {
      console.error("Gateway error:", error);

      if (error instanceof Error) {
        if (error.message.includes("timeout")) {
          return createErrorResponse(
            c,
            "Request timeout",
            "gateway_error",
            "TIMEOUT",
            504,
          );
        }

        return createErrorResponse(
          c,
          error.message,
          "gateway_error",
          "INTERNAL_ERROR",
          500,
        );
      }

      return createErrorResponse(
        c,
        "Unknown error occurred",
        "gateway_error",
        "UNKNOWN_ERROR",
        500,
      );
    }
  });

  return router;
}
