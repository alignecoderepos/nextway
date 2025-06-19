/**
 * AI Gateway - Main entry point
 * Unified gateway that routes requests to OpenAI or Anthropic based on model mappings
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { loadConfig, getConfig, getProviderForModel } from './config.js';
import { OpenAIProvider } from './providers/openai.js';
import { AnthropicProvider } from './providers/anthropic.js';
import type { OpenAIRequest } from './providers/openai.js';

// Rate limiting store (in-memory for simplicity)
interface RateLimitEntry {
  tokens: number;
  lastRefill: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

class RateLimiter {
  private maxTokens: number;
  private refillRate: number; // tokens per minute

  constructor(maxTokens: number) {
    this.maxTokens = maxTokens;
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

    // Refill tokens based on time passed
    const timePassed = now - entry.lastRefill;
    const tokensToAdd = Math.floor((timePassed / (60 * 1000)) * this.refillRate);
    
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

// Initialize configuration and providers
loadConfig();
const config = getConfig();
const rateLimiter = new RateLimiter(config.rate_limits.per_minute);
const openaiProvider = new OpenAIProvider();
const anthropicProvider = new AnthropicProvider();

const app = new Hono();

// Configure CORS with explicit options
const corsOptions = {
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['Content-Length'],
  maxAge: 600,
  credentials: true,
};

// Middleware
app.use('*', cors(corsOptions));
app.use('*', logger());

// Error response helper
function createErrorResponse(c: any, message: string, type = 'gateway_error', code = 'UNKNOWN', status = 500) {
  return c.json(
    {
      error: {
        message,
        type,
        code,
      },
    },
    status
  );
}

// Rate limiting middleware
app.use('/v1/chat/completions', async (c, next) => {
  const authHeader = c.req.header('authorization');
  const key = authHeader?.startsWith('Bearer ') 
    ? authHeader.slice(7) 
    : c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';

  if (!rateLimiter.isAllowed(key)) {
    return createErrorResponse(
      c,
      'Rate limit exceeded',
      'rate_limit_error',
      'RATE_LIMIT_EXCEEDED',
      429
    );
  }

  await next();
});

// Main chat completions endpoint
app.post('/v1/chat/completions', async (c) => {
  try {
    const request: OpenAIRequest = await c.req.json();
    
    if (!request.model) {
      return createErrorResponse(
        c,
        'Model is required',
        'invalid_request_error',
        'MISSING_MODEL',
        400
      );
    }

    if (!request.messages || !Array.isArray(request.messages)) {
      return createErrorResponse(
        c,
        'Messages array is required',
        'invalid_request_error',
        'MISSING_MESSAGES',
        400
      );
    }

    const provider = getProviderForModel(request.model);
    
    if (config.logging.level === 'debug') {
      console.log(`Routing model ${request.model} to provider: ${provider}`);
    }

    let response: Response;
    
    if (provider === 'openai') {
      response = await openaiProvider.chatCompletions(request);
    } else {
      response = await anthropicProvider.chatCompletions(request);
    }

    // Handle provider errors
    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`Provider error (${response.status}):`, errorBody);
      
      return createErrorResponse(
        c,
        `Provider returned error: ${response.status}`,
        'provider_error',
        'PROVIDER_ERROR',
        response.status
      );
    }

    // Convert the provider's response to a format Hono can handle
    const responseData = await response.json();
    return c.json(responseData, response.status as ContentfulStatusCode);

  } catch (error) {
    console.error('Gateway error:', error);
    
    if (error instanceof Error) {
      if (error.message.includes('timeout')) {
        return createErrorResponse(
          c,
          'Request timeout',
          'gateway_error',
          'TIMEOUT',
          504
        );
      }
      
      return createErrorResponse(
        c,
        error.message,
        'gateway_error',
        'INTERNAL_ERROR',
        500
      );
    }

    return createErrorResponse(
      c,
      'Unknown error occurred',
      'gateway_error',
      'UNKNOWN_ERROR',
      500
    );
  }
});

// Health check endpoint
app.get('/health', (c) => {
  return c.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Index page - proof the server is running
app.get('/', (c) => {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Gateway</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #333;
        }
        
        .container {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            padding: 3rem;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
            max-width: 600px;
            width: 90%;
            text-align: center;
            border: 1px solid rgba(255, 255, 255, 0.2);
        }
        
        .logo {
            width: 80px;
            height: 80px;
            background: linear-gradient(135deg, #667eea, #764ba2);
            border-radius: 16px;
            margin: 0 auto 2rem;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 2rem;
            color: white;
            font-weight: bold;
        }
        
        h1 {
            font-size: 2.5rem;
            font-weight: 700;
            margin-bottom: 0.5rem;
            background: linear-gradient(135deg, #667eea, #764ba2);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }
        
        .subtitle {
            font-size: 1.1rem;
            color: #666;
            margin-bottom: 2rem;
            font-weight: 400;
        }
        
        .status {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            background: #10b981;
            color: white;
            padding: 0.5rem 1rem;
            border-radius: 50px;
            font-weight: 600;
            margin-bottom: 2rem;
            font-size: 0.9rem;
        }
        
        .status::before {
            content: '';
            width: 8px;
            height: 8px;
            background: white;
            border-radius: 50%;
            animation: pulse 2s infinite;
        }
        
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
        
        .info-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1.5rem;
            margin-bottom: 2rem;
        }
        
        .info-card {
            background: rgba(102, 126, 234, 0.1);
            border-radius: 12px;
            padding: 1.5rem;
            border: 1px solid rgba(102, 126, 234, 0.2);
        }
        
        .info-card h3 {
            font-size: 0.9rem;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #667eea;
            margin-bottom: 0.5rem;
            font-weight: 600;
        }
        
        .info-card p {
            font-size: 1.1rem;
            font-weight: 600;
            color: #333;
        }
        
        .endpoint {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 1rem;
            font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
            font-size: 0.9rem;
            color: #4a5568;
            margin-bottom: 1.5rem;
            word-break: break-all;
        }
        
        .providers {
            display: flex;
            justify-content: center;
            gap: 1rem;
            margin-top: 1rem;
        }
        
        .provider {
            background: white;
            border: 2px solid #e2e8f0;
            border-radius: 8px;
            padding: 0.75rem 1rem;
            font-size: 0.9rem;
            font-weight: 600;
            color: #4a5568;
        }
        
        .footer {
            margin-top: 2rem;
            padding-top: 1.5rem;
            border-top: 1px solid #e2e8f0;
            font-size: 0.85rem;
            color: #666;
        }
        
        @media (max-width: 640px) {
            .container {
                padding: 2rem;
                margin: 1rem;
            }
            
            h1 {
                font-size: 2rem;
            }
            
            .info-grid {
                grid-template-columns: 1fr;
            }
            
            .providers {
                flex-direction: column;
                align-items: center;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">AI</div>
        <h1>AI Gateway</h1>
        <p class="subtitle">Unified API for OpenAI and Anthropic</p>
        
        <div class="status">
            Gateway Online
        </div>
        
        <div class="info-grid">
            <div class="info-card">
                <h3>Endpoint</h3>
                <p>/v1/chat/completions</p>
            </div>
            <div class="info-card">
                <h3>Protocol</h3>
                <p>OpenAI Compatible</p>
            </div>
            <div class="info-card">
                <h3>Rate Limit</h3>
                <p>${config.rate_limits.per_minute}/min</p>
            </div>
            <div class="info-card">
                <h3>Default Provider</h3>
                <p>${config.default_provider.toUpperCase()}</p>
            </div>
        </div>
        
        <div class="endpoint">
            POST ${c.req.url.replace(c.req.path, '')}/v1/chat/completions
        </div>
        
        <div class="providers">
            <div class="provider">OpenAI</div>
            <div class="provider">Anthropic</div>
        </div>
        
        <div class="footer">
            Ready to route your AI requests<br>
            <strong>Status:</strong> Healthy • <strong>Uptime:</strong> ${process.uptime().toFixed(0)}s
        </div>
    </div>
</body>
</html>
  `;
  
  return c.html(html);
});

// Start server
const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;

console.log(`🚀 AI Gateway starting on port ${port}`);
console.log(`📝 Logging level: ${config.logging.level}`);
console.log(`⚡ Rate limit: ${config.rate_limits.per_minute} requests/minute`);

import { serve } from '@hono/node-server';

const server = serve({
  fetch: app.fetch,
  port,
});

console.log(`✅ Server is running on http://localhost:${port}`);

// Handle shutdown gracefully
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
  });
});