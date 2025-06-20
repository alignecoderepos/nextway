# AI Gateway

A unified gateway that provides a single OpenAI-compatible endpoint for both OpenAI and Anthropic APIs. Route requests to different providers based on model mappings while maintaining full compatibility with OpenAI's Chat Completions API.

## Features

- **Single Endpoint**: `/v1/chat/completions` compatible with OpenAI API
- **Multi-Provider**: Route to OpenAI or Anthropic based on model
- **Streaming Support**: Full streaming support for both providers
- **Rate Limiting**: Token-bucket rate limiting per IP/API key
- **Error Handling**: Consistent OpenAI-style error responses
- **Configuration**: YAML-based configuration with environment variable secrets
- **Guardrails**: Data privacy checks with PII detection logged per request

## Setup

1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Set environment variables:**

   ```bash
   export OPENAI_API_KEY="your-openai-key"
   export ANTHROPIC_API_KEY="your-anthropic-key"
   ```

3. **Configure the gateway** by editing `config.yaml`:
   ```yaml
   default_provider: openai
   model_mappings:
     gpt-4o-mini: openai
     claude-3-sonnet: anthropic
   ```

## Running

### Development

```bash
npm run dev
```

### Production

```bash
npm run build
npm start
```

The gateway runs on port 3000 by default (configurable via `PORT` environment variable).

## API Usage

### Non-streaming Request (OpenAI model)

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {"role": "user", "content": "Hello, how are you?"}
    ],
    "temperature": 0.7
  }'
```

### Streaming Request (Anthropic model)

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "model": "claude-3-sonnet",
    "messages": [
      {"role": "user", "content": "Write a short poem"}
    ],
    "stream": true
  }'
```

### Health Check

```bash
curl http://localhost:3000/health
```

## Configuration

The `config.yaml` file controls:

- **Provider Selection**: Map models to providers
- **API Endpoints**: Configure provider endpoints
- **Rate Limiting**: Set requests per minute limits
- **Timeouts**: Configure request timeouts
- **Logging**: Set log levels
- **Guardrails**: Optional PII detection settings

Example configuration:

```yaml
default_provider: openai
timeout_ms: 30000

providers:
  openai:
    api_key_env: OPENAI_API_KEY
    endpoint: https://api.openai.com/v1/chat/completions
  anthropic:
    api_key_env: ANTHROPIC_API_KEY
    endpoint: https://api.anthropic.com/v1/messages

model_mappings:
  gpt-4o-mini: openai
  claude-3-sonnet: anthropic

rate_limits:
  per_minute: 60

logging:
  level: info

guardrails:
  data_privacy:
    enabled: false
    mode: log
    aws_region: us-east-1
    access_key_id_env: AWS_ACCESS_KEY_ID
    secret_access_key_env: AWS_SECRET_ACCESS_KEY
```

## Error Handling

All errors return OpenAI-compatible error format:

```json
{
  "error": {
    "message": "Request timeout",
    "type": "gateway_error",
    "code": "TIMEOUT"
  }
}
```

## Testing

Run tests:

```bash
npm test
```

## Architecture

- **`index.ts`**: Main Hono app with routing and middleware
- **`config.ts`**: YAML configuration loader with Zod validation
- **`providers/openai.ts`**: OpenAI API client (pass-through)
- **`providers/anthropic.ts`**: Anthropic API client with format conversion
- **Rate Limiting**: In-memory token bucket per IP/API key
- **Streaming**: Server-sent events for real-time responses

## How to Run

1. **Clone and install:**

   ```bash
   npm install
   ```

2. **Set your API keys:**

   ```bash
   export OPENAI_API_KEY="sk-..."
   export ANTHROPIC_API_KEY="sk-ant-..."
   ```

3. **Start development server:**

   ```bash
   npm run dev
   ```

4. **Test with cURL:**

   ```bash
   # Test OpenAI model (pass-through)
   curl -X POST http://localhost:3000/v1/chat/completions \
     -H "Content-Type: application/json" \
     -d '{"model": "gpt-4o-mini", "messages": [{"role": "user", "content": "Hello!"}]}'

   # Test Anthropic model (transcoded)
   curl -X POST http://localhost:3000/v1/chat/completions \
     -H "Content-Type: application/json" \
     -d '{"model": "claude-3-sonnet", "messages": [{"role": "user", "content": "Hello!"}], "stream": true}'
   ```
