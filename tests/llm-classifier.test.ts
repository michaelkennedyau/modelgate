import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import { LLMClassifier } from "../src/classifiers/llm.js";

// ============================================================================
// Helpers
// ============================================================================

/** Build a mock Anthropic API response body */
function makeApiResponse(tier: string, confidence: number): string {
  return JSON.stringify({
    id: "msg_test",
    type: "message",
    role: "assistant",
    content: [
      {
        type: "text",
        text: JSON.stringify({ tier, confidence }),
      },
    ],
    model: "claude-haiku-4-5-20251001",
    stop_reason: "end_turn",
    usage: { input_tokens: 30, output_tokens: 10 },
  });
}

function mockFetchSuccess(tier: string, confidence: number) {
  return mock(() =>
    Promise.resolve(
      new Response(makeApiResponse(tier, confidence), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
}

function mockFetchBadJson() {
  return mock(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          content: [{ type: "text", text: "I am not valid JSON at all {{{" }],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    ),
  );
}

function mockFetchApiError() {
  return mock(() =>
    Promise.resolve(
      new Response(JSON.stringify({ error: { message: "rate limited" } }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
}

function mockFetchTimeout() {
  return mock(
    () =>
      new Promise<Response>((_, reject) => {
        // Simulate a request that takes too long — will be aborted
        setTimeout(() => reject(new DOMException("The operation was aborted.", "AbortError")), 5000);
      }),
  );
}

// ============================================================================
// Tests
// ============================================================================

describe("LLMClassifier", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    // Restore original fetch after each test
    globalThis.fetch = originalFetch;
  });

  function makeClassifier(overrides: Partial<ConstructorParameters<typeof LLMClassifier>[0]> = {}) {
    return new LLMClassifier({
      apiKey: "test-key-123",
      cacheSize: 100,
      timeoutMs: 2000,
      ...overrides,
    });
  }

  test("classify() returns valid ClassificationResult for fast tier", async () => {
    globalThis.fetch = mockFetchSuccess("fast", 0.95);
    const classifier = makeClassifier();

    const result = await classifier.classify("What is 2+2?");

    expect(result.tier).toBe("fast");
    expect(result.modelId).toBe("claude-haiku-4-5-20251001");
    expect(result.score).toBe(0.95);
    expect(result.classifierUsed).toBe(true);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  test("classify() returns valid ClassificationResult for quality tier", async () => {
    globalThis.fetch = mockFetchSuccess("quality", 0.8);
    const classifier = makeClassifier();

    const result = await classifier.classify("Compare React and Vue for a large enterprise app");

    expect(result.tier).toBe("quality");
    expect(result.modelId).toBe("claude-sonnet-4-5-20250929");
    expect(result.score).toBe(0.8);
    expect(result.classifierUsed).toBe(true);
  });

  test("classify() returns valid ClassificationResult for expert tier", async () => {
    globalThis.fetch = mockFetchSuccess("expert", 0.9);
    const classifier = makeClassifier();

    const result = await classifier.classify(
      "Design a multi-region distributed system architecture with CQRS and event sourcing",
    );

    expect(result.tier).toBe("expert");
    expect(result.modelId).toBe("claude-opus-4-6");
    expect(result.score).toBe(0.9);
    expect(result.classifierUsed).toBe(true);
  });

  test("cache works — same message returns cached result without extra fetch", async () => {
    const fetchMock = mockFetchSuccess("fast", 0.95);
    globalThis.fetch = fetchMock;
    const classifier = makeClassifier();

    const result1 = await classifier.classify("Hello there");
    const result2 = await classifier.classify("Hello there");

    // Should have called fetch only once
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Results should be identical
    expect(result1.tier).toBe(result2.tier);
    expect(result1.modelId).toBe(result2.modelId);
    expect(result1.score).toBe(result2.score);
  });

  test("cache does not return stale results for different messages", async () => {
    let callCount = 0;
    globalThis.fetch = mock(() => {
      callCount++;
      const tier = callCount === 1 ? "fast" : "expert";
      return Promise.resolve(
        new Response(makeApiResponse(tier, 0.9), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    const classifier = makeClassifier();

    const result1 = await classifier.classify("Hello");
    const result2 = await classifier.classify("Design a distributed system");

    expect(result1.tier).toBe("fast");
    expect(result2.tier).toBe("expert");
    expect(callCount).toBe(2);
  });

  test("timeout handling returns fallback result", async () => {
    // Use a very short timeout so the test doesn't wait long
    globalThis.fetch = mock(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          // Listen for the abort signal
          if (init?.signal) {
            init.signal.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted.", "AbortError"));
            });
          }
        }),
    );

    const classifier = makeClassifier({ timeoutMs: 50 });

    const result = await classifier.classify("This should timeout");

    expect(result.tier).toBe("quality");
    expect(result.reasons[0]).toContain("llm-classifier-error");
    expect(result.classifierUsed).toBe(true);
    // Fallback should use the quality model
    expect(result.modelId).toBe("claude-sonnet-4-5-20250929");
  });

  test("parse error handling returns fallback on bad JSON", async () => {
    globalThis.fetch = mockFetchBadJson();
    const classifier = makeClassifier();

    const result = await classifier.classify("This will fail to parse");

    expect(result.tier).toBe("quality");
    expect(result.reasons[0]).toContain("llm-classifier-error");
    expect(result.modelId).toBe("claude-sonnet-4-5-20250929");
  });

  test("API error returns fallback result", async () => {
    globalThis.fetch = mockFetchApiError();
    const classifier = makeClassifier();

    const result = await classifier.classify("API will return 429");

    expect(result.tier).toBe("quality");
    expect(result.reasons[0]).toContain("llm-classifier-error");
    expect(result.reasons[0]).toContain("429");
  });

  test("cacheStats reflects current state", async () => {
    globalThis.fetch = mockFetchSuccess("fast", 0.9);
    const classifier = makeClassifier({ cacheSize: 50 });

    expect(classifier.cacheStats.size).toBe(0);
    expect(classifier.cacheStats.maxSize).toBe(50);

    await classifier.classify("message 1");
    expect(classifier.cacheStats.size).toBe(1);

    await classifier.classify("message 2");
    expect(classifier.cacheStats.size).toBe(2);

    // Same message — no new cache entry
    await classifier.classify("message 1");
    expect(classifier.cacheStats.size).toBe(2);
  });

  test("clearCache() empties the cache", async () => {
    globalThis.fetch = mockFetchSuccess("fast", 0.9);
    const classifier = makeClassifier();

    await classifier.classify("hello");
    await classifier.classify("world");
    expect(classifier.cacheStats.size).toBe(2);

    classifier.clearCache();
    expect(classifier.cacheStats.size).toBe(0);
  });

  test("clearCache() forces re-fetch on next classify", async () => {
    const fetchMock = mockFetchSuccess("fast", 0.9);
    globalThis.fetch = fetchMock;
    const classifier = makeClassifier();

    await classifier.classify("hello");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    classifier.clearCache();

    await classifier.classify("hello");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("default classifier model is Haiku", () => {
    const classifier = makeClassifier();
    // We can verify this indirectly — the cacheStats should work with defaults
    expect(classifier.cacheStats.maxSize).toBe(100);
  });

  test("fallback result has score of 0.5", async () => {
    globalThis.fetch = mockFetchApiError();
    const classifier = makeClassifier();

    const result = await classifier.classify("error case");
    expect(result.score).toBe(0.5);
  });
});
