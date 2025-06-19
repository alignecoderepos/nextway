/**
 * Anthropic API client wrapper
 * Handles request/response translation between OpenAI and Anthropic formats
 */

import { getConfig } from '../config.js';
import type { OpenAIRequest } from './openai.js';

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AnthropicRequest {
  model: string;
  max_tokens: number;
  messages: AnthropicMessage[];
  system?: string;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
}

export interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<{
    type: 'text';
    text: string;
  }>;
  model: string;
  stop_reason: string | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export class AnthropicProvider {
  private apiKey: string;
  private endpoint: string;
  private timeoutMs: number;

  constructor() {
    const config = getConfig();
    this.apiKey = process.env[config.providers.anthropic.api_key_env]!;
    this.endpoint = config.providers.anthropic.endpoint;
    this.timeoutMs = config.timeout_ms;
  }

  /**
   * Convert OpenAI format to Anthropic format
   */
  private convertRequest(openaiRequest: OpenAIRequest): AnthropicRequest {
    const { messages, model, temperature, top_p, max_tokens = 1024, stream } = openaiRequest;
    
    // Extract system message if present
    let system: string | undefined;
    const anthropicMessages: AnthropicMessage[] = [];
    
    for (const message of messages) {
      if (message.role === 'system') {
        system = message.content;
      } else if (message.role === 'user' || message.role === 'assistant') {
        anthropicMessages.push({
          role: message.role,
          content: message.content,
        });
      }
    }

    const anthropicRequest: AnthropicRequest = {
      model: this.mapModel(model),
      max_tokens,
      messages: anthropicMessages,
    };

    if (system) {
      anthropicRequest.system = system;
    }
    if (temperature !== undefined) {
      anthropicRequest.temperature = temperature;
    }
    if (top_p !== undefined) {
      anthropicRequest.top_p = top_p;
    }
    if (stream !== undefined) {
      anthropicRequest.stream = stream;
    }

    return anthropicRequest;
  }

  /**
   * Convert Anthropic response to OpenAI format
   */
  private convertResponse(anthropicResponse: AnthropicResponse): any {
    const content = anthropicResponse.content
      .filter(item => item.type === 'text')
      .map(item => item.text)
      .join('');

    return {
      id: `chatcmpl-${anthropicResponse.id}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: anthropicResponse.model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content,
          },
          finish_reason: this.mapFinishReason(anthropicResponse.stop_reason),
        },
      ],
      usage: {
        prompt_tokens: anthropicResponse.usage.input_tokens,
        completion_tokens: anthropicResponse.usage.output_tokens,
        total_tokens: anthropicResponse.usage.input_tokens + anthropicResponse.usage.output_tokens,
      },
    };
  }

  /**
   * Convert streaming chunk from Anthropic to OpenAI format
   */
  private convertStreamChunk(chunk: any): string {
    if (chunk.type === 'content_block_delta' && chunk.delta?.text) {
      const openaiChunk = {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'claude-3-sonnet',
        choices: [
          {
            index: 0,
            delta: {
              content: chunk.delta.text,
            },
            finish_reason: null,
          },
        ],
      };
      return `data: ${JSON.stringify(openaiChunk)}\n\n`;
    } else if (chunk.type === 'message_stop') {
      const openaiChunk = {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'claude-3-sonnet',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop',
          },
        ],
      };
      return `data: ${JSON.stringify(openaiChunk)}\n\ndata: [DONE]\n\n`;
    }
    return '';
  }

  private mapModel(openaiModel: string): string {
    const modelMap: Record<string, string> = {
      'claude-3-sonnet': 'claude-3-sonnet-20240229',
      'claude-3-opus': 'claude-3-opus-20240229',
      'claude-3-haiku': 'claude-3-haiku-20240307',
      'claude-3-5-sonnet': 'claude-3-5-sonnet-20241022',
    };
    return modelMap[openaiModel] || openaiModel;
  }

  private mapFinishReason(anthropicReason: string | null): string {
    const reasonMap: Record<string, string> = {
      'end_turn': 'stop',
      'max_tokens': 'length',
      'stop_sequence': 'stop',
    };
    return reasonMap[anthropicReason || ''] || 'stop';
  }

  async chatCompletions(request: OpenAIRequest): Promise<Response> {
    const anthropicRequest = this.convertRequest(request);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(anthropicRequest),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (request.stream) {
        // Handle streaming response
        const readableStream = new ReadableStream({
          async start(controller) {
            const reader = response.body?.getReader();
            if (!reader) {
              controller.close();
              return;
            }

            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = new TextDecoder().decode(value);
                const lines = chunk.split('\n');
                
                for (const line of lines) {
                  if (line.startsWith('data: ')) {
                    try {
                      const data = JSON.parse(line.slice(6));
                      const converted = this.convertStreamChunk(data);
                      if (converted) {
                        controller.enqueue(new TextEncoder().encode(converted));
                      }
                    } catch (e) {
                      // Skip invalid JSON
                    }
                  }
                }
              }
            } finally {
              controller.close();
            }
          },
        });

        return new Response(readableStream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          },
        });
      } else {
        // Handle non-streaming response
        if (!response.ok) {
          return response; // Return error response as-is
        }

        const anthropicResponse: AnthropicResponse = await response.json();
        const openaiResponse = this.convertResponse(anthropicResponse);
        
        return new Response(JSON.stringify(openaiResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      throw error;
    }
  }
}