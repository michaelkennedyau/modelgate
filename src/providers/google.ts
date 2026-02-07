/**
 * ModelGate — Google Gemini adapter
 *
 * Implements the ProviderAdapter interface for Google's Generative Language API.
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
import { parseSSEStream } from "./base.js";

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_TIMEOUT = 30_000;

export class GoogleAdapter implements ProviderAdapter {
  readonly name: Provider = "google";
  private readonly config: ProviderConfig;
  private readonly baseUrl: string;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  }

  /**
   * Map standard role names to Google's expected roles.
   * Google uses "user" and "model" (not "assistant").
   */
  private mapRole(role: string): string {
    if (role === "assistant") return "model";
    return role;
  }

  /**
   * Build the Google-formatted request body from a unified ChatRequest.
   */
  private buildBody(request: ChatRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      contents: request.messages.map((m) => ({
        role: this.mapRole(m.role),
        parts: [{ text: m.content }],
      })),
    };

    if (request.systemPrompt) {
      body.systemInstruction = {
        parts: [{ text: request.systemPrompt }],
      };
    }

    const generationConfig: Record<string, unknown> = {};
    if (request.maxTokens !== undefined) {
      generationConfig.maxOutputTokens = request.maxTokens;
    }
    if (request.temperature !== undefined) {
      generationConfig.temperature = request.temperature;
    }
    if (Object.keys(generationConfig).length > 0) {
      body.generationConfig = generationConfig;
    }

    return body;
  }

  /**
   * Build the URL for a chat or stream request.
   */
  private buildUrl(model: string, stream: boolean): string {
    const base = `${this.baseUrl}/${model}`;
    if (stream) {
      return `${base}:streamGenerateContent?alt=sse&key=${this.config.apiKey}`;
    }
    return `${base}:generateContent?key=${this.config.apiKey}`;
  }

  /**
   * Send a chat request and get a complete response.
   */
  async chat(request: ChatRequest): Promise<ChatResponse> {
    const url = this.buildUrl(request.model, false);
    const body = this.buildBody(request);

    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: request.signal ?? AbortSignal.timeout(this.config.timeout ?? DEFAULT_TIMEOUT),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google API error (${response.status}): ${errorText}`);
    }

    // biome-ignore lint/suspicious/noExplicitAny: Google API response shape
    const data: any = await response.json();
    const candidate = data.candidates?.[0];

    // Extract text from all parts
    const content =
      candidate?.content?.parts?.map((part: { text?: string }) => part.text ?? "").join("") ?? "";

    return {
      content,
      modelId: request.model,
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      },
      stopReason: candidate?.finishReason ?? undefined,
    };
  }

  /**
   * Send a chat request and stream the response as chunks.
   */
  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    const url = this.buildUrl(request.model, true);
    const body = this.buildBody(request);

    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: request.signal ?? AbortSignal.timeout(this.config.timeout ?? DEFAULT_TIMEOUT),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google API error (${response.status}): ${errorText}`);
    }

    let lastInputTokens = 0;
    let lastOutputTokens = 0;

    for await (const data of parseSSEStream(response)) {
      try {
        const event = JSON.parse(data);
        const candidate = event.candidates?.[0];

        // Extract text from parts
        if (candidate?.content?.parts) {
          for (const part of candidate.content.parts) {
            if (part.text) {
              yield { type: "text", text: part.text };
            }
          }
        }

        // Track usage metadata
        if (event.usageMetadata) {
          lastInputTokens = event.usageMetadata.promptTokenCount ?? 0;
          lastOutputTokens = event.usageMetadata.candidatesTokenCount ?? 0;
          yield {
            type: "usage",
            usage: {
              inputTokens: lastInputTokens,
              outputTokens: lastOutputTokens,
            },
          };
        }

        // Google signals completion with a finishReason
        if (candidate?.finishReason) {
          yield {
            type: "done",
            usage: {
              inputTokens: lastInputTokens,
              outputTokens: lastOutputTokens,
            },
          };
        }
      } catch {
        // Skip non-JSON lines
      }
    }
  }
}
