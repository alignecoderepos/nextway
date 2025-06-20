/**
 * AI Gateway - Main entry point
 * Sets up the Hono application and mounts handlers.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { gatewayLogger } from "./middleware/log/index.js";
import { createRotatingFileLogger } from "./utils/rotating-file-logger.js";
import { loadConfig, getConfig } from "./config.js";
import { chatCompletionsHandler } from "./handlers/chat-completions.js";

// Load configuration before creating handlers
loadConfig();
const config = getConfig();

const app = new Hono();

// CORS options matching the previous implementation
const corsOptions = {
  origin: "*",
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
  exposeHeaders: ["Content-Length"],
  maxAge: 600,
  credentials: true,
};

app.use("*", cors(corsOptions));
const fileLogger = createRotatingFileLogger();
app.use(
  "*",
  gatewayLogger({
    level: config.logging.level,
    log: (entry) => {
      const { requestId, method, path, status, latencyMs } = entry;
      console.log(
        `[${requestId}] ${method} ${path} -> ${status} (${latencyMs}ms)`,
      );
      if (config.logging.level === "debug") {
        console.debug(JSON.stringify(entry, null, 2));
      }
      fileLogger(JSON.stringify(entry));
    },
  }),
);

// Mount chat completions router
app.route("/v1/chat/completions", chatCompletionsHandler());

// Health check endpoint
app.get("/health", (c) => {
  return c.json({ status: "healthy", timestamp: new Date().toISOString() });
});

// Index page - proof the server is running
app.get("/", (c) => {
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
            POST ${c.req.url.replace(c.req.path, "")}/v1/chat/completions
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

import { serve } from "@hono/node-server";

const server = serve({
  fetch: app.fetch,
  port,
});

console.log(`✅ Server is running on http://localhost:${port}`);

process.on("SIGTERM", () => {
  console.log("SIGTERM signal received: closing HTTP server");
  server.close(() => {
    console.log("HTTP server closed");
  });
});
