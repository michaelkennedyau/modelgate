/**
 * ModelGate — Provider base utilities
 *
 * Shared helpers for all provider adapters: header creation,
 * SSE stream parsing, and the provider factory.
 */

import type { Provider, ProviderAdapter, ProviderConfig } from "../types.js";
import { AnthropicAdapter } from "./anthropic.js";
import { GoogleAdapter } from "./google.js";
import { OpenAIAdapter } from "./openai.js";

/**
 * Create standard HTTP headers with authentication for a provider.
 */
export function createHeaders(provider: Provider, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  switch (provider) {
    case "anthropic":
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
      break;
    case "openai":
      headers.authorization = `Bearer ${apiKey}`;
      break;
    case "google":
      // Google uses query-parameter auth, no auth header needed
      break;
    default:
      headers.authorization = `Bearer ${apiKey}`;
      break;
  }

  return headers;
}

/**
 * Parse a Server-Sent Events (SSE) stream into individual data payloads.
 *
 * Yields the string content of each `data:` line. Skips empty lines,
 * comment lines, and other SSE fields (event:, id:, retry:).
 */
export async function* parseSSEStream(response: Response): AsyncIterable<string> {
  if (!response.body) {
    throw new Error("Response body is null — cannot parse SSE stream");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        // Process any remaining data in the buffer
        if (buffer.trim()) {
          for (const line of buffer.split("\n")) {
            const trimmed = line.trim();
            if (trimmed.startsWith("data:")) {
              const data = trimmed.slice(5).trim();
              if (data) {
                yield data;
              }
            }
          }
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      // Process complete lines
      const lines = buffer.split("\n");
      // Keep the last (potentially incomplete) line in the buffer
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":")) {
          // Empty line or SSE comment — skip
          continue;
        }
        if (trimmed.startsWith("data:")) {
          const data = trimmed.slice(5).trim();
          if (data) {
            yield data;
          }
        }
        // Ignore event:, id:, retry: fields
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Provider factory — create the correct adapter by provider name.
 *
 * @throws Error if the provider is not supported
 */
export function createProvider(provider: Provider, config: ProviderConfig): ProviderAdapter {
  switch (provider) {
    case "anthropic":
      return new AnthropicAdapter(config);
    case "openai":
      return new OpenAIAdapter(config);
    case "google":
      return new GoogleAdapter(config);
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}
