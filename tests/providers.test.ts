import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { AnthropicAdapter } from "../src/providers/anthropic.js";
import { createHeaders, createProvider, parseSSEStream } from "../src/providers/base.js";
import { GoogleAdapter } from "../src/providers/google.js";
import { OpenAIAdapter } from "../src/providers/openai.js";
import type { ChatRequest, ChatResponse, ProviderConfig, StreamChunk } from "../src/types.js";

// ============================================================================
// HELPERS
// ============================================================================

const originalFetch = globalThis.fetch;

/** Restore global fetch after each test */
function restoreFetch() {
  globalThis.fetch = originalFetch;
}

/** Create a mock Response with a readable body from SSE text */
function mockSSEResponse(sseText: string, status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(sseText));
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { "content-type": "text/event-stream" },
  });
}

/** Create a mock Response with JSON body */
function mockJSONResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Create a mock Response with plain text body (for errors) */
function mockTextResponse(text: string, status: number): Response {
  return new Response(text, {
    status,
    headers: { "content-type": "text/plain" },
  });
}

/** Standard provider config for testing */
const testConfig: ProviderConfig = {
  apiKey: "test-api-key-123",
  timeout: 5000,
};

/** Standard chat request for testing */
const testRequest: ChatRequest = {
  model: "test-model",
  messages: [{ role: "user", content: "Hello, world!" }],
  maxTokens: 256,
  temperature: 0.7,
};

/** Collect all chunks from an async iterable */
async function collectChunks(iterable: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of iterable) {
    chunks.push(chunk);
  }
  return chunks;
}

// ============================================================================
// BASE UTILITIES
// ============================================================================

describe("Base utilities", () => {
  afterEach(restoreFetch);

  // ── createHeaders ──────────────────────────────────────────────────────
  describe("createHeaders()", () => {
    test("Anthropic headers include x-api-key and version", () => {
      const headers = createHeaders("anthropic", "sk-ant-test");
      expect(headers["x-api-key"]).toBe("sk-ant-test");
      expect(headers["anthropic-version"]).toBe("2023-06-01");
      expect(headers["content-type"]).toBe("application/json");
    });

    test("OpenAI headers include Bearer authorization", () => {
      const headers = createHeaders("openai", "sk-openai-test");
      expect(headers.authorization).toBe("Bearer sk-openai-test");
      expect(headers["content-type"]).toBe("application/json");
      expect(headers["x-api-key"]).toBeUndefined();
    });

    test("Google headers include only content-type (auth via query param)", () => {
      const headers = createHeaders("google", "google-key");
      expect(headers["content-type"]).toBe("application/json");
      expect(headers.authorization).toBeUndefined();
      expect(headers["x-api-key"]).toBeUndefined();
    });

    test("custom provider falls back to Bearer auth", () => {
      const headers = createHeaders("custom", "custom-key");
      expect(headers.authorization).toBe("Bearer custom-key");
      expect(headers["content-type"]).toBe("application/json");
    });
  });

  // ── parseSSEStream ─────────────────────────────────────────────────────
  describe("parseSSEStream()", () => {
    test("parses simple data lines", async () => {
      const response = mockSSEResponse('data: {"text": "hello"}\n\ndata: {"text": "world"}\n\n');
      const chunks: string[] = [];
      for await (const chunk of parseSSEStream(response)) {
        chunks.push(chunk);
      }
      expect(chunks).toEqual(['{"text": "hello"}', '{"text": "world"}']);
    });

    test("skips comment lines", async () => {
      const response = mockSSEResponse(': this is a comment\ndata: {"val": 1}\n\n');
      const chunks: string[] = [];
      for await (const chunk of parseSSEStream(response)) {
        chunks.push(chunk);
      }
      expect(chunks).toEqual(['{"val": 1}']);
    });

    test("skips empty lines", async () => {
      const response = mockSSEResponse("\n\ndata: content\n\n\n\n");
      const chunks: string[] = [];
      for await (const chunk of parseSSEStream(response)) {
        chunks.push(chunk);
      }
      expect(chunks).toEqual(["content"]);
    });

    test("handles [DONE] marker", async () => {
      const response = mockSSEResponse('data: {"text": "hi"}\n\ndata: [DONE]\n\n');
      const chunks: string[] = [];
      for await (const chunk of parseSSEStream(response)) {
        chunks.push(chunk);
      }
      expect(chunks).toEqual(['{"text": "hi"}', "[DONE]"]);
    });

    test("throws on null body", async () => {
      const response = new Response(null);
      // Override body to null
      Object.defineProperty(response, "body", { value: null });
      const iter = parseSSEStream(response);
      try {
        // biome-ignore lint/suspicious/noExplicitAny: test helper
        for await (const _ of iter as any) {
          // should not reach here
        }
        expect(true).toBe(false); // fail if no error thrown
      } catch (err) {
        expect((err as Error).message).toContain("null");
      }
    });

    test("ignores event: and id: fields", async () => {
      const response = mockSSEResponse('event: message\nid: 123\ndata: {"val": "ok"}\n\n');
      const chunks: string[] = [];
      for await (const chunk of parseSSEStream(response)) {
        chunks.push(chunk);
      }
      expect(chunks).toEqual(['{"val": "ok"}']);
    });
  });

  // ── createProvider ─────────────────────────────────────────────────────
  describe("createProvider()", () => {
    test("creates AnthropicAdapter for 'anthropic'", () => {
      const adapter = createProvider("anthropic", testConfig);
      expect(adapter).toBeInstanceOf(AnthropicAdapter);
      expect(adapter.name).toBe("anthropic");
    });

    test("creates OpenAIAdapter for 'openai'", () => {
      const adapter = createProvider("openai", testConfig);
      expect(adapter).toBeInstanceOf(OpenAIAdapter);
      expect(adapter.name).toBe("openai");
    });

    test("creates GoogleAdapter for 'google'", () => {
      const adapter = createProvider("google", testConfig);
      expect(adapter).toBeInstanceOf(GoogleAdapter);
      expect(adapter.name).toBe("google");
    });

    test("throws for unsupported provider", () => {
      expect(() => createProvider("custom", testConfig)).toThrow("Unsupported provider");
    });
  });
});

// ============================================================================
// ANTHROPIC ADAPTER
// ============================================================================

describe("AnthropicAdapter", () => {
  afterEach(restoreFetch);

  describe("chat()", () => {
    test("sends correct request format", async () => {
      let capturedUrl = "";
      let capturedInit: RequestInit | undefined;

      globalThis.fetch = async (input, init) => {
        capturedUrl = input as string;
        capturedInit = init;
        return mockJSONResponse({
          content: [{ type: "text", text: "Hi there!" }],
          model: "claude-haiku-4-5-20251001",
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: "end_turn",
        });
      };

      const adapter = new AnthropicAdapter(testConfig);
      await adapter.chat(testRequest);

      expect(capturedUrl).toBe("https://api.anthropic.com/v1/messages");
      const body = JSON.parse(capturedInit?.body as string);
      expect(body.model).toBe("test-model");
      expect(body.messages).toEqual([{ role: "user", content: "Hello, world!" }]);
      expect(body.max_tokens).toBe(256);
      expect(body.temperature).toBe(0.7);
      expect(body.stream).toBeUndefined();
    });

    test("includes system prompt when provided", async () => {
      let capturedBody: Record<string, unknown> = {};

      globalThis.fetch = async (_input, init) => {
        capturedBody = JSON.parse(init?.body as string);
        return mockJSONResponse({
          content: [{ type: "text", text: "Response" }],
          usage: { input_tokens: 15, output_tokens: 8 },
        });
      };

      const adapter = new AnthropicAdapter(testConfig);
      await adapter.chat({ ...testRequest, systemPrompt: "You are helpful." });

      expect(capturedBody.system).toBe("You are helpful.");
    });

    test("parses response correctly", async () => {
      globalThis.fetch = async () =>
        mockJSONResponse({
          content: [
            { type: "text", text: "Hello " },
            { type: "text", text: "world!" },
          ],
          model: "claude-haiku-4-5-20251001",
          usage: { input_tokens: 12, output_tokens: 7 },
          stop_reason: "end_turn",
        });

      const adapter = new AnthropicAdapter(testConfig);
      const result = await adapter.chat(testRequest);

      expect(result.content).toBe("Hello world!");
      expect(result.modelId).toBe("claude-haiku-4-5-20251001");
      expect(result.usage.inputTokens).toBe(12);
      expect(result.usage.outputTokens).toBe(7);
      expect(result.stopReason).toBe("end_turn");
    });

    test("throws on non-200 response", async () => {
      globalThis.fetch = async () => mockTextResponse("Unauthorized", 401);

      const adapter = new AnthropicAdapter(testConfig);
      await expect(adapter.chat(testRequest)).rejects.toThrow("Anthropic API error (401)");
    });

    test("uses custom base URL from config", async () => {
      let capturedUrl = "";
      globalThis.fetch = async (input, _init) => {
        capturedUrl = input as string;
        return mockJSONResponse({
          content: [{ type: "text", text: "ok" }],
          usage: { input_tokens: 1, output_tokens: 1 },
        });
      };

      const adapter = new AnthropicAdapter({
        ...testConfig,
        baseUrl: "https://custom.api.com/v1/messages",
      });
      await adapter.chat(testRequest);

      expect(capturedUrl).toBe("https://custom.api.com/v1/messages");
    });
  });

  describe("stream()", () => {
    test("yields text chunks from content_block_delta events", async () => {
      const sseData = [
        'data: {"type":"message_start","message":{"usage":{"input_tokens":10}}}',
        'data: {"type":"content_block_delta","delta":{"text":"Hello"}}',
        'data: {"type":"content_block_delta","delta":{"text":" world"}}',
        'data: {"type":"message_delta","usage":{"output_tokens":5}}',
        'data: {"type":"message_stop"}',
      ].join("\n\n");

      globalThis.fetch = async () => mockSSEResponse(sseData);

      const adapter = new AnthropicAdapter(testConfig);
      const chunks = await collectChunks(adapter.stream(testRequest));

      const textChunks = chunks.filter((c) => c.type === "text");
      expect(textChunks).toHaveLength(2);
      expect(textChunks[0].text).toBe("Hello");
      expect(textChunks[1].text).toBe(" world");
    });

    test("yields usage and done chunks", async () => {
      const sseData = [
        'data: {"type":"message_start","message":{"usage":{"input_tokens":20}}}',
        'data: {"type":"content_block_delta","delta":{"text":"Hi"}}',
        'data: {"type":"message_delta","usage":{"output_tokens":10}}',
        'data: {"type":"message_stop"}',
      ].join("\n\n");

      globalThis.fetch = async () => mockSSEResponse(sseData);

      const adapter = new AnthropicAdapter(testConfig);
      const chunks = await collectChunks(adapter.stream(testRequest));

      const usageChunk = chunks.find((c) => c.type === "usage");
      expect(usageChunk?.usage?.inputTokens).toBe(20);
      expect(usageChunk?.usage?.outputTokens).toBe(10);

      const doneChunk = chunks.find((c) => c.type === "done");
      expect(doneChunk).toBeDefined();
    });

    test("throws on non-200 stream response", async () => {
      globalThis.fetch = async () => mockTextResponse("Rate limited", 429);

      const adapter = new AnthropicAdapter(testConfig);
      await expect(collectChunks(adapter.stream(testRequest))).rejects.toThrow(
        "Anthropic API error (429)",
      );
    });
  });
});

// ============================================================================
// OPENAI ADAPTER
// ============================================================================

describe("OpenAIAdapter", () => {
  afterEach(restoreFetch);

  describe("chat()", () => {
    test("sends correct request format with system message", async () => {
      let capturedBody: Record<string, unknown> = {};

      globalThis.fetch = async (_input, init) => {
        capturedBody = JSON.parse(init?.body as string);
        return mockJSONResponse({
          choices: [{ message: { content: "Hi!" }, finish_reason: "stop" }],
          model: "gpt-4o-mini",
          usage: { prompt_tokens: 8, completion_tokens: 3 },
        });
      };

      const adapter = new OpenAIAdapter(testConfig);
      await adapter.chat({
        ...testRequest,
        systemPrompt: "Be concise.",
      });

      // System message should be prepended
      const messages = capturedBody.messages as Array<{ role: string; content: string }>;
      expect(messages[0]).toEqual({ role: "system", content: "Be concise." });
      expect(messages[1]).toEqual({ role: "user", content: "Hello, world!" });
      expect(capturedBody.model).toBe("test-model");
      expect(capturedBody.max_tokens).toBe(256);
      expect(capturedBody.temperature).toBe(0.7);
    });

    test("sends correct URL and auth headers", async () => {
      let capturedUrl = "";
      let capturedHeaders: Record<string, string> = {};

      globalThis.fetch = async (input, init) => {
        capturedUrl = input as string;
        capturedHeaders = Object.fromEntries(
          Object.entries(init?.headers as Record<string, string>),
        );
        return mockJSONResponse({
          choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        });
      };

      const adapter = new OpenAIAdapter(testConfig);
      await adapter.chat(testRequest);

      expect(capturedUrl).toBe("https://api.openai.com/v1/chat/completions");
      expect(capturedHeaders.authorization).toBe("Bearer test-api-key-123");
    });

    test("parses response correctly", async () => {
      globalThis.fetch = async () =>
        mockJSONResponse({
          choices: [{ message: { content: "Great answer!" }, finish_reason: "stop" }],
          model: "gpt-4o",
          usage: { prompt_tokens: 15, completion_tokens: 8 },
        });

      const adapter = new OpenAIAdapter(testConfig);
      const result = await adapter.chat(testRequest);

      expect(result.content).toBe("Great answer!");
      expect(result.modelId).toBe("gpt-4o");
      expect(result.usage.inputTokens).toBe(15);
      expect(result.usage.outputTokens).toBe(8);
      expect(result.stopReason).toBe("stop");
    });

    test("handles empty choices gracefully", async () => {
      globalThis.fetch = async () =>
        mockJSONResponse({
          choices: [],
          usage: { prompt_tokens: 5, completion_tokens: 0 },
        });

      const adapter = new OpenAIAdapter(testConfig);
      const result = await adapter.chat(testRequest);

      expect(result.content).toBe("");
    });

    test("throws on non-200 response", async () => {
      globalThis.fetch = async () => mockTextResponse("Server error", 500);

      const adapter = new OpenAIAdapter(testConfig);
      await expect(adapter.chat(testRequest)).rejects.toThrow("OpenAI API error (500)");
    });
  });

  describe("stream()", () => {
    test("yields text chunks from delta events", async () => {
      const sseData = [
        'data: {"choices":[{"delta":{"content":"Hello"}}]}',
        'data: {"choices":[{"delta":{"content":" there"}}]}',
        "data: [DONE]",
      ].join("\n\n");

      globalThis.fetch = async () => mockSSEResponse(sseData);

      const adapter = new OpenAIAdapter(testConfig);
      const chunks = await collectChunks(adapter.stream(testRequest));

      const textChunks = chunks.filter((c) => c.type === "text");
      expect(textChunks).toHaveLength(2);
      expect(textChunks[0].text).toBe("Hello");
      expect(textChunks[1].text).toBe(" there");
    });

    test("yields done chunk on [DONE]", async () => {
      const sseData = ['data: {"choices":[{"delta":{"content":"x"}}]}', "data: [DONE]"].join(
        "\n\n",
      );

      globalThis.fetch = async () => mockSSEResponse(sseData);

      const adapter = new OpenAIAdapter(testConfig);
      const chunks = await collectChunks(adapter.stream(testRequest));

      const doneChunk = chunks.find((c) => c.type === "done");
      expect(doneChunk).toBeDefined();
    });

    test("skips deltas without content", async () => {
      const sseData = [
        'data: {"choices":[{"delta":{"role":"assistant"}}]}',
        'data: {"choices":[{"delta":{"content":"text"}}]}',
        "data: [DONE]",
      ].join("\n\n");

      globalThis.fetch = async () => mockSSEResponse(sseData);

      const adapter = new OpenAIAdapter(testConfig);
      const chunks = await collectChunks(adapter.stream(testRequest));

      const textChunks = chunks.filter((c) => c.type === "text");
      expect(textChunks).toHaveLength(1);
      expect(textChunks[0].text).toBe("text");
    });

    test("throws on non-200 stream response", async () => {
      globalThis.fetch = async () => mockTextResponse("Bad Request", 400);

      const adapter = new OpenAIAdapter(testConfig);
      await expect(collectChunks(adapter.stream(testRequest))).rejects.toThrow(
        "OpenAI API error (400)",
      );
    });
  });
});

// ============================================================================
// GOOGLE ADAPTER
// ============================================================================

describe("GoogleAdapter", () => {
  afterEach(restoreFetch);

  describe("chat()", () => {
    test("sends correct URL with API key as query param", async () => {
      let capturedUrl = "";

      globalThis.fetch = async (input, _init) => {
        capturedUrl = input as string;
        return mockJSONResponse({
          candidates: [{ content: { parts: [{ text: "Hi!" }] }, finishReason: "STOP" }],
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3 },
        });
      };

      const adapter = new GoogleAdapter(testConfig);
      await adapter.chat({ ...testRequest, model: "gemini-2.5-flash" });

      expect(capturedUrl).toContain("gemini-2.5-flash:generateContent");
      expect(capturedUrl).toContain("key=test-api-key-123");
      expect(capturedUrl).not.toContain("alt=sse");
    });

    test("sends correct request body with role mapping", async () => {
      let capturedBody: Record<string, unknown> = {};

      globalThis.fetch = async (_input, init) => {
        capturedBody = JSON.parse(init?.body as string);
        return mockJSONResponse({
          candidates: [{ content: { parts: [{ text: "ok" }] } }],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
        });
      };

      const adapter = new GoogleAdapter(testConfig);
      await adapter.chat({
        model: "gemini-2.5-flash",
        messages: [
          { role: "user", content: "Hi" },
          { role: "assistant", content: "Hello" },
          { role: "user", content: "How are you?" },
        ],
        systemPrompt: "Be helpful.",
        maxTokens: 100,
        temperature: 0.5,
      });

      // Check role mapping: assistant -> model
      const contents = capturedBody.contents as Array<{ role: string }>;
      expect(contents[0].role).toBe("user");
      expect(contents[1].role).toBe("model");
      expect(contents[2].role).toBe("user");

      // System instruction
      const systemInst = capturedBody.systemInstruction as { parts: Array<{ text: string }> };
      expect(systemInst.parts[0].text).toBe("Be helpful.");

      // Generation config
      const genConfig = capturedBody.generationConfig as Record<string, unknown>;
      expect(genConfig.maxOutputTokens).toBe(100);
      expect(genConfig.temperature).toBe(0.5);
    });

    test("parses response correctly", async () => {
      globalThis.fetch = async () =>
        mockJSONResponse({
          candidates: [
            {
              content: {
                parts: [{ text: "Part 1 " }, { text: "Part 2" }],
              },
              finishReason: "STOP",
            },
          ],
          usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 12 },
        });

      const adapter = new GoogleAdapter(testConfig);
      const result = await adapter.chat({
        ...testRequest,
        model: "gemini-2.5-flash",
      });

      expect(result.content).toBe("Part 1 Part 2");
      expect(result.modelId).toBe("gemini-2.5-flash");
      expect(result.usage.inputTokens).toBe(20);
      expect(result.usage.outputTokens).toBe(12);
      expect(result.stopReason).toBe("STOP");
    });

    test("handles empty candidates gracefully", async () => {
      globalThis.fetch = async () =>
        mockJSONResponse({
          candidates: [],
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 0 },
        });

      const adapter = new GoogleAdapter(testConfig);
      const result = await adapter.chat({
        ...testRequest,
        model: "gemini-2.5-flash",
      });

      expect(result.content).toBe("");
    });

    test("throws on non-200 response", async () => {
      globalThis.fetch = async () => mockTextResponse("Forbidden", 403);

      const adapter = new GoogleAdapter(testConfig);
      await expect(adapter.chat({ ...testRequest, model: "gemini-2.5-flash" })).rejects.toThrow(
        "Google API error (403)",
      );
    });

    test("omits generationConfig when no maxTokens or temperature", async () => {
      let capturedBody: Record<string, unknown> = {};

      globalThis.fetch = async (_input, init) => {
        capturedBody = JSON.parse(init?.body as string);
        return mockJSONResponse({
          candidates: [{ content: { parts: [{ text: "ok" }] } }],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
        });
      };

      const adapter = new GoogleAdapter(testConfig);
      await adapter.chat({
        model: "gemini-2.5-flash",
        messages: [{ role: "user", content: "Hi" }],
      });

      expect(capturedBody.generationConfig).toBeUndefined();
    });
  });

  describe("stream()", () => {
    test("uses stream URL with alt=sse", async () => {
      let capturedUrl = "";

      const sseData = [
        'data: {"candidates":[{"content":{"parts":[{"text":"Hi"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":2}}',
      ].join("\n\n");

      globalThis.fetch = async (input, _init) => {
        capturedUrl = input as string;
        return mockSSEResponse(sseData);
      };

      const adapter = new GoogleAdapter(testConfig);
      await collectChunks(adapter.stream({ ...testRequest, model: "gemini-2.5-flash" }));

      expect(capturedUrl).toContain(":streamGenerateContent");
      expect(capturedUrl).toContain("alt=sse");
      expect(capturedUrl).toContain("key=test-api-key-123");
    });

    test("yields text and done chunks", async () => {
      const sseData = [
        'data: {"candidates":[{"content":{"parts":[{"text":"Hello "}]}}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":1}}',
        'data: {"candidates":[{"content":{"parts":[{"text":"world"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":3}}',
      ].join("\n\n");

      globalThis.fetch = async () => mockSSEResponse(sseData);

      const adapter = new GoogleAdapter(testConfig);
      const chunks = await collectChunks(
        adapter.stream({ ...testRequest, model: "gemini-2.5-flash" }),
      );

      const textChunks = chunks.filter((c) => c.type === "text");
      expect(textChunks).toHaveLength(2);
      expect(textChunks[0].text).toBe("Hello ");
      expect(textChunks[1].text).toBe("world");

      const doneChunk = chunks.find((c) => c.type === "done");
      expect(doneChunk).toBeDefined();
      expect(doneChunk?.usage?.outputTokens).toBe(3);
    });

    test("throws on non-200 stream response", async () => {
      globalThis.fetch = async () => mockTextResponse("Not Found", 404);

      const adapter = new GoogleAdapter(testConfig);
      await expect(
        collectChunks(adapter.stream({ ...testRequest, model: "gemini-2.5-flash" })),
      ).rejects.toThrow("Google API error (404)");
    });
  });
});

// ============================================================================
// ERROR HANDLING (cross-provider)
// ============================================================================

describe("Error handling", () => {
  afterEach(restoreFetch);

  test("Anthropic: network error propagates", async () => {
    globalThis.fetch = async () => {
      throw new Error("Network failure");
    };

    const adapter = new AnthropicAdapter(testConfig);
    await expect(adapter.chat(testRequest)).rejects.toThrow("Network failure");
  });

  test("OpenAI: network error propagates", async () => {
    globalThis.fetch = async () => {
      throw new Error("Connection refused");
    };

    const adapter = new OpenAIAdapter(testConfig);
    await expect(adapter.chat(testRequest)).rejects.toThrow("Connection refused");
  });

  test("Google: network error propagates", async () => {
    globalThis.fetch = async () => {
      throw new Error("DNS resolution failed");
    };

    const adapter = new GoogleAdapter(testConfig);
    await expect(adapter.chat({ ...testRequest, model: "gemini-2.5-flash" })).rejects.toThrow(
      "DNS resolution failed",
    );
  });

  test("Anthropic stream: network error propagates", async () => {
    globalThis.fetch = async () => {
      throw new Error("Stream network error");
    };

    const adapter = new AnthropicAdapter(testConfig);
    await expect(collectChunks(adapter.stream(testRequest))).rejects.toThrow(
      "Stream network error",
    );
  });

  test("OpenAI stream: network error propagates", async () => {
    globalThis.fetch = async () => {
      throw new Error("Stream timeout");
    };

    const adapter = new OpenAIAdapter(testConfig);
    await expect(collectChunks(adapter.stream(testRequest))).rejects.toThrow("Stream timeout");
  });

  test("Google stream: network error propagates", async () => {
    globalThis.fetch = async () => {
      throw new Error("Google stream error");
    };

    const adapter = new GoogleAdapter(testConfig);
    await expect(
      collectChunks(adapter.stream({ ...testRequest, model: "gemini-2.5-flash" })),
    ).rejects.toThrow("Google stream error");
  });
});

// ============================================================================
// ADAPTER INTERFACE COMPLIANCE
// ============================================================================

describe("Adapter interface compliance", () => {
  test("AnthropicAdapter has correct name", () => {
    const adapter = new AnthropicAdapter(testConfig);
    expect(adapter.name).toBe("anthropic");
  });

  test("OpenAIAdapter has correct name", () => {
    const adapter = new OpenAIAdapter(testConfig);
    expect(adapter.name).toBe("openai");
  });

  test("GoogleAdapter has correct name", () => {
    const adapter = new GoogleAdapter(testConfig);
    expect(adapter.name).toBe("google");
  });

  test("AnthropicAdapter has chat and stream methods", () => {
    const adapter = new AnthropicAdapter(testConfig);
    expect(typeof adapter.chat).toBe("function");
    expect(typeof adapter.stream).toBe("function");
  });

  test("OpenAIAdapter has chat and stream methods", () => {
    const adapter = new OpenAIAdapter(testConfig);
    expect(typeof adapter.chat).toBe("function");
    expect(typeof adapter.stream).toBe("function");
  });

  test("GoogleAdapter has chat and stream methods", () => {
    const adapter = new GoogleAdapter(testConfig);
    expect(typeof adapter.chat).toBe("function");
    expect(typeof adapter.stream).toBe("function");
  });
});
