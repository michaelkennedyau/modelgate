/**
 * ModelGate — Anthropic Claude adapter
 *
 * Implements the ProviderAdapter interface for Anthropic's Messages API.
 * Uses fetch() directly — no SDK dependency.
 */

import type {
  ChatRequest,
  ChatResponse,
  Provider,
  ProviderAdapter,
  ProviderConfig,
  StreamChunk,
} from "../types.js";
import { createHeaders, parseSSEStream } from "./base.js";

const DEFAULT_BASE_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_MAX_TOKENS = 1024;

export class AnthropicAdapter implements ProviderAdapter {
  readonly name: Provider = "anthropic";
  private readonly config: ProviderConfig;
  private readonly baseUrl: string;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  }

  /**
   * Build the Anthropic-formatted request body from a unified ChatRequest.
   */
  private buildBody(request: ChatRequest, stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
    };

    if (request.systemPrompt) {
      body.system = request.systemPrompt;
    }

    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }

    if (stream) {
      body.stream = true;
    }

    return body;
  }

  /**
   * Send a chat request and get a complete response.
   */
  async chat(request: ChatRequest): Promise<ChatResponse> {
    const headers = createHeaders("anthropic", this.config.apiKey);
    const body = this.buildBody(request, false);

    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: request.signal ?? AbortSignal.timeout(this.config.timeout ?? DEFAULT_TIMEOUT),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
    }

    // biome-ignore lint/suspicious/noExplicitAny: Anthropic API response shape
    const data: any = await response.json();

    // Extract text from content blocks
    const content = data.content
      .filter((block: { type: string }) => block.type === "text")
      .map((block: { text: string }) => block.text)
      .join("");

    return {
      content,
      modelId: data.model ?? request.model,
      usage: {
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
      },
      stopReason: data.stop_reason ?? undefined,
    };
  }

  /**
   * Send a chat request and stream the response as chunks.
   */
  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    const headers = createHeaders("anthropic", this.config.apiKey);
    const body = this.buildBody(request, true);

    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: request.signal ?? AbortSignal.timeout(this.config.timeout ?? DEFAULT_TIMEOUT),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
    }

    let inputTokens = 0;
    let outputTokens = 0;

    for await (const data of parseSSEStream(response)) {
      try {
        const event = JSON.parse(data);

        switch (event.type) {
          case "message_start":
            // Extract input token count from the initial message
            if (event.message?.usage?.input_tokens) {
              inputTokens = event.message.usage.input_tokens;
            }
            break;

          case "content_block_delta":
            if (event.delta?.text) {
              yield { type: "text", text: event.delta.text };
            }
            break;

          case "message_delta":
            // Final usage stats
            if (event.usage?.output_tokens) {
              outputTokens = event.usage.output_tokens;
            }
            yield {
              type: "usage",
              usage: { inputTokens, outputTokens },
            };
            break;

          case "message_stop":
            yield {
              type: "done",
              usage: { inputTokens, outputTokens },
            };
            break;
        }
      } catch {
        // Skip non-JSON SSE lines (e.g., event: prefixes)
      }
    }
  }
}
