/**
 * ModelGate — OpenAI adapter
 *
 * Implements the ProviderAdapter interface for OpenAI's Chat Completions API.
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

const DEFAULT_BASE_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_TIMEOUT = 30_000;

export class OpenAIAdapter implements ProviderAdapter {
  readonly name: Provider = "openai";
  private readonly config: ProviderConfig;
  private readonly baseUrl: string;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  }

  /**
   * Build OpenAI-formatted messages from a unified ChatRequest.
   * System prompt becomes a system message at the start of the array.
   */
  private buildMessages(request: ChatRequest): Array<{ role: string; content: string }> {
    const messages: Array<{ role: string; content: string }> = [];

    if (request.systemPrompt) {
      messages.push({ role: "system", content: request.systemPrompt });
    }

    for (const msg of request.messages) {
      messages.push({ role: msg.role, content: msg.content });
    }

    return messages;
  }

  /**
   * Build the OpenAI-formatted request body.
   */
  private buildBody(request: ChatRequest, stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: this.buildMessages(request),
    };

    if (request.maxTokens !== undefined) {
      body.max_tokens = request.maxTokens;
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
    const headers = createHeaders("openai", this.config.apiKey);
    const body = this.buildBody(request, false);

    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: request.signal ?? AbortSignal.timeout(this.config.timeout ?? DEFAULT_TIMEOUT),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
    }

    // biome-ignore lint/suspicious/noExplicitAny: OpenAI API response shape
    const data: any = await response.json();
    const choice = data.choices?.[0];

    return {
      content: choice?.message?.content ?? "",
      modelId: data.model ?? request.model,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      },
      stopReason: choice?.finish_reason ?? undefined,
    };
  }

  /**
   * Send a chat request and stream the response as chunks.
   */
  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    const headers = createHeaders("openai", this.config.apiKey);
    const body = this.buildBody(request, true);

    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: request.signal ?? AbortSignal.timeout(this.config.timeout ?? DEFAULT_TIMEOUT),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
    }

    for await (const data of parseSSEStream(response)) {
      // OpenAI signals end of stream with [DONE]
      if (data === "[DONE]") {
        yield { type: "done" };
        break;
      }

      try {
        const event = JSON.parse(data);
        const choice = event.choices?.[0];

        if (choice?.delta?.content) {
          yield { type: "text", text: choice.delta.content };
        }

        // Some OpenAI responses include usage in the final chunk
        if (event.usage) {
          yield {
            type: "usage",
            usage: {
              inputTokens: event.usage.prompt_tokens ?? 0,
              outputTokens: event.usage.completion_tokens ?? 0,
            },
          };
        }
      } catch {
        // Skip non-JSON lines
      }
    }
  }
}
