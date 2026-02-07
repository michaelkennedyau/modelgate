import { describe, expect, test } from "bun:test";
import {
  cachingMiddleware,
  costRecorderMiddleware,
  loggingMiddleware,
  retryMiddleware,
  timeoutMiddleware,
} from "../src/middleware/builtins.js";
import { MiddlewarePipeline } from "../src/middleware/pipeline.js";
import type { Middleware, RequestContext, ResponseContext } from "../src/types.js";

// ============================================================================
// TEST HELPERS
// ============================================================================

function makeCtx(overrides?: Partial<RequestContext>): RequestContext {
  return {
    messages: [{ role: "user", content: "Hello" }],
    classification: {
      tier: "fast",
      modelId: "claude-haiku-4-5-20251001",
      score: 0.2,
      reasons: ["simple greeting"],
    },
    metadata: {},
    ...overrides,
  };
}

function makeResponse(overrides?: Partial<ResponseContext>): ResponseContext {
  return {
    content: "Hi there!",
    modelId: "claude-haiku-4-5-20251001",
    tier: "fast",
    usage: { inputTokens: 10, outputTokens: 5 },
    metadata: {},
    ...overrides,
  };
}

function makeFinalHandler(
  response?: ResponseContext,
): (ctx: RequestContext) => Promise<ResponseContext> {
  return async () => response ?? makeResponse();
}

// ============================================================================
// PIPELINE CORE
// ============================================================================

describe("MiddlewarePipeline", () => {
  test("empty pipeline calls finalHandler directly", async () => {
    const pipeline = new MiddlewarePipeline();
    const expected = makeResponse();
    const result = await pipeline.execute(makeCtx(), makeFinalHandler(expected));
    expect(result).toEqual(expected);
  });

  test("single middleware wraps the call", async () => {
    const pipeline = new MiddlewarePipeline();
    const calls: string[] = [];

    pipeline.use(async (ctx, next) => {
      calls.push("before");
      const res = await next();
      calls.push("after");
      return res;
    });

    await pipeline.execute(makeCtx(), makeFinalHandler());
    expect(calls).toEqual(["before", "after"]);
  });

  test("middlewares execute in registration order", async () => {
    const pipeline = new MiddlewarePipeline();
    const order: number[] = [];

    pipeline.use(async (_ctx, next) => {
      order.push(1);
      const res = await next();
      order.push(6);
      return res;
    });
    pipeline.use(async (_ctx, next) => {
      order.push(2);
      const res = await next();
      order.push(5);
      return res;
    });
    pipeline.use(async (_ctx, next) => {
      order.push(3);
      const res = await next();
      order.push(4);
      return res;
    });

    await pipeline.execute(makeCtx(), async () => {
      order.push(0);
      return makeResponse();
    });

    // Onion model: 1, 2, 3, handler(0), 4, 5, 6
    expect(order).toEqual([1, 2, 3, 0, 4, 5, 6]);
  });

  test("middleware can modify request context before next()", async () => {
    const pipeline = new MiddlewarePipeline();

    pipeline.use(async (ctx, next) => {
      ctx.maxTokens = 2048;
      ctx.metadata.modified = true;
      return next();
    });

    let captured: RequestContext | undefined;
    await pipeline.execute(makeCtx(), async (ctx) => {
      captured = ctx;
      return makeResponse();
    });

    expect(captured?.maxTokens).toBe(2048);
    expect(captured?.metadata.modified).toBe(true);
  });

  test("middleware can modify response after next()", async () => {
    const pipeline = new MiddlewarePipeline();

    pipeline.use(async (_ctx, next) => {
      const res = await next();
      return { ...res, content: `${res.content} [modified]` };
    });

    const result = await pipeline.execute(makeCtx(), makeFinalHandler());
    expect(result.content).toBe("Hi there! [modified]");
  });

  test("short-circuit: middleware returns without calling next()", async () => {
    const pipeline = new MiddlewarePipeline();
    let finalHandlerCalled = false;

    const cachedResponse = makeResponse({ content: "cached" });

    pipeline.use(async () => {
      // Short-circuit — never calls next()
      return cachedResponse;
    });

    pipeline.use(async (_ctx, next) => {
      // This should never run
      return next();
    });

    const result = await pipeline.execute(makeCtx(), async () => {
      finalHandlerCalled = true;
      return makeResponse();
    });

    expect(result.content).toBe("cached");
    expect(finalHandlerCalled).toBe(false);
  });

  test("error in middleware propagates to caller", async () => {
    const pipeline = new MiddlewarePipeline();

    pipeline.use(async () => {
      throw new Error("middleware boom");
    });

    await expect(pipeline.execute(makeCtx(), makeFinalHandler())).rejects.toThrow(
      "middleware boom",
    );
  });

  test("error in finalHandler propagates through middleware", async () => {
    const pipeline = new MiddlewarePipeline();
    const calls: string[] = [];

    pipeline.use(async (_ctx, next) => {
      calls.push("before");
      try {
        return await next();
      } catch (err) {
        calls.push("caught");
        throw err;
      }
    });

    await expect(
      pipeline.execute(makeCtx(), async () => {
        throw new Error("handler boom");
      }),
    ).rejects.toThrow("handler boom");

    expect(calls).toEqual(["before", "caught"]);
  });

  test("calling next() multiple times is allowed (supports retry)", async () => {
    const pipeline = new MiddlewarePipeline();
    let callCount = 0;

    pipeline.use(async (_ctx, next) => {
      // First attempt fails
      try {
        return await next();
      } catch {
        // Retry once
        return next();
      }
    });

    const result = await pipeline.execute(makeCtx(), async () => {
      callCount++;
      if (callCount === 1) throw new Error("transient");
      return makeResponse({ content: "recovered" });
    });

    expect(callCount).toBe(2);
    expect(result.content).toBe("recovered");
  });

  test("use() returns this for chaining", () => {
    const pipeline = new MiddlewarePipeline();
    const noop: Middleware = async (_ctx, next) => next();
    const result = pipeline.use(noop).use(noop);
    expect(result).toBe(pipeline);
  });

  test("multiple middlewares each modify context cumulatively", async () => {
    const pipeline = new MiddlewarePipeline();

    pipeline.use(async (ctx, next) => {
      ctx.metadata.step1 = true;
      return next();
    });

    pipeline.use(async (ctx, next) => {
      ctx.metadata.step2 = true;
      return next();
    });

    let captured: RequestContext | undefined;
    await pipeline.execute(makeCtx(), async (ctx) => {
      captured = ctx;
      return makeResponse();
    });

    expect(captured?.metadata.step1).toBe(true);
    expect(captured?.metadata.step2).toBe(true);
  });

  test("response modifications compose in reverse order", async () => {
    const pipeline = new MiddlewarePipeline();

    pipeline.use(async (_ctx, next) => {
      const res = await next();
      return { ...res, content: `[A ${res.content} A]` };
    });

    pipeline.use(async (_ctx, next) => {
      const res = await next();
      return { ...res, content: `[B ${res.content} B]` };
    });

    const result = await pipeline.execute(
      makeCtx(),
      makeFinalHandler(makeResponse({ content: "core" })),
    );

    // Inner middleware (B) wraps first, then outer (A) wraps
    expect(result.content).toBe("[A [B core B] A]");
  });
});

// ============================================================================
// LOGGING MIDDLEWARE
// ============================================================================

describe("loggingMiddleware", () => {
  test("logs request classification and response timing", async () => {
    const logs: string[] = [];
    const mw = loggingMiddleware((msg) => logs.push(msg));
    const pipeline = new MiddlewarePipeline().use(mw);

    await pipeline.execute(makeCtx(), makeFinalHandler());

    expect(logs.length).toBe(2);
    expect(logs[0]).toContain("tier=fast");
    expect(logs[0]).toContain("model=claude-haiku-4-5-20251001");
    expect(logs[1]).toContain("response");
    expect(logs[1]).toMatch(/latency=\d+ms/);
  });

  test("uses console.log by default (no crash)", async () => {
    const mw = loggingMiddleware();
    const pipeline = new MiddlewarePipeline().use(mw);

    // Should not throw
    await pipeline.execute(makeCtx(), makeFinalHandler());
  });

  test("propagates errors from next()", async () => {
    const logs: string[] = [];
    const mw = loggingMiddleware((msg) => logs.push(msg));
    const pipeline = new MiddlewarePipeline().use(mw);

    await expect(
      pipeline.execute(makeCtx(), async () => {
        throw new Error("downstream error");
      }),
    ).rejects.toThrow("downstream error");

    // Request was logged but response was not (error before response)
    expect(logs.length).toBe(1);
  });
});

// ============================================================================
// RETRY MIDDLEWARE
// ============================================================================

describe("retryMiddleware", () => {
  test("returns on first success without retrying", async () => {
    let attempts = 0;
    const mw = retryMiddleware({ maxRetries: 2 });
    const pipeline = new MiddlewarePipeline().use(mw);

    const result = await pipeline.execute(makeCtx(), async () => {
      attempts++;
      return makeResponse();
    });

    expect(attempts).toBe(1);
    expect(result.content).toBe("Hi there!");
  });

  test("retries on failure up to maxRetries", async () => {
    let attempts = 0;
    const mw = retryMiddleware({ maxRetries: 2, backoffMs: 1 });
    const pipeline = new MiddlewarePipeline().use(mw);

    const result = await pipeline.execute(makeCtx(), async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error(`fail attempt ${attempts}`);
      }
      return makeResponse({ content: "success on 3rd" });
    });

    expect(attempts).toBe(3); // 1 initial + 2 retries
    expect(result.content).toBe("success on 3rd");
  });

  test("throws last error after exhausting retries", async () => {
    let attempts = 0;
    const mw = retryMiddleware({ maxRetries: 2, backoffMs: 1 });
    const pipeline = new MiddlewarePipeline().use(mw);

    await expect(
      pipeline.execute(makeCtx(), async () => {
        attempts++;
        throw new Error(`fail ${attempts}`);
      }),
    ).rejects.toThrow("fail 3");

    expect(attempts).toBe(3);
  });

  test("respects maxRetries=0 (no retries)", async () => {
    let attempts = 0;
    const mw = retryMiddleware({ maxRetries: 0, backoffMs: 1 });
    const pipeline = new MiddlewarePipeline().use(mw);

    await expect(
      pipeline.execute(makeCtx(), async () => {
        attempts++;
        throw new Error("always fail");
      }),
    ).rejects.toThrow("always fail");

    expect(attempts).toBe(1);
  });

  test("uses default values (2 retries, 100ms backoff)", async () => {
    let attempts = 0;
    const mw = retryMiddleware(); // defaults
    const pipeline = new MiddlewarePipeline().use(mw);

    // Use a very short test — just verify defaults work without long waits
    const start = Date.now();
    await expect(
      pipeline.execute(makeCtx(), async () => {
        attempts++;
        throw new Error("fail");
      }),
    ).rejects.toThrow("fail");

    expect(attempts).toBe(3); // 1 + 2 retries

    // Should have waited at least 100ms + 200ms = 300ms backoff
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(250); // allow some timing slack
  });

  test("respects AbortSignal — stops retrying when aborted", async () => {
    let attempts = 0;
    const controller = new AbortController();
    const mw = retryMiddleware({ maxRetries: 5, backoffMs: 50 });
    const pipeline = new MiddlewarePipeline().use(mw);

    // Abort after a short delay
    setTimeout(() => controller.abort(), 30);

    await expect(
      pipeline.execute(makeCtx({ signal: controller.signal }), async () => {
        attempts++;
        throw new Error("fail");
      }),
    ).rejects.toThrow();

    // Should not have completed all 6 attempts due to abort
    expect(attempts).toBeLessThan(6);
  });

  test("exponential backoff increases delay between retries", async () => {
    let attempts = 0;
    const timestamps: number[] = [];
    const mw = retryMiddleware({ maxRetries: 2, backoffMs: 50 });
    const pipeline = new MiddlewarePipeline().use(mw);

    await expect(
      pipeline.execute(makeCtx(), async () => {
        timestamps.push(Date.now());
        attempts++;
        throw new Error("fail");
      }),
    ).rejects.toThrow();

    expect(timestamps.length).toBe(3);

    // Gap between attempt 1 and 2 should be ~50ms
    const gap1 = timestamps[1] - timestamps[0];
    // Gap between attempt 2 and 3 should be ~100ms (doubled)
    const gap2 = timestamps[2] - timestamps[1];

    expect(gap1).toBeGreaterThanOrEqual(40);
    expect(gap2).toBeGreaterThanOrEqual(80);
    // Second gap should be roughly double the first
    expect(gap2).toBeGreaterThan(gap1);
  });
});

// ============================================================================
// TIMEOUT MIDDLEWARE
// ============================================================================

describe("timeoutMiddleware", () => {
  test("passes through when response is fast enough", async () => {
    const mw = timeoutMiddleware(1000);
    const pipeline = new MiddlewarePipeline().use(mw);

    const result = await pipeline.execute(makeCtx(), makeFinalHandler());
    expect(result.content).toBe("Hi there!");
  });

  test("throws on timeout with descriptive message", async () => {
    const mw = timeoutMiddleware(50);
    const pipeline = new MiddlewarePipeline().use(mw);

    await expect(
      pipeline.execute(makeCtx(), async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return makeResponse();
      }),
    ).rejects.toThrow("Middleware timeout: request exceeded 50ms");
  });

  test("propagates downstream errors (not timeout)", async () => {
    const mw = timeoutMiddleware(5000);
    const pipeline = new MiddlewarePipeline().use(mw);

    await expect(
      pipeline.execute(makeCtx(), async () => {
        throw new Error("real error");
      }),
    ).rejects.toThrow("real error");
  });

  test("uses 30000ms default timeout", async () => {
    // We can't actually wait 30 seconds, so just verify a fast response passes
    const mw = timeoutMiddleware();
    const pipeline = new MiddlewarePipeline().use(mw);

    const result = await pipeline.execute(makeCtx(), makeFinalHandler());
    expect(result.content).toBe("Hi there!");
  });
});

// ============================================================================
// CACHING MIDDLEWARE
// ============================================================================

describe("cachingMiddleware", () => {
  test("cache miss calls next() and returns response", async () => {
    let callCount = 0;
    const mw = cachingMiddleware({ maxSize: 10, ttlMs: 60_000 });
    const pipeline = new MiddlewarePipeline().use(mw);

    const result = await pipeline.execute(makeCtx(), async () => {
      callCount++;
      return makeResponse({ content: "fresh" });
    });

    expect(callCount).toBe(1);
    expect(result.content).toBe("fresh");
  });

  test("cache hit returns cached response without calling next()", async () => {
    let callCount = 0;
    const mw = cachingMiddleware({ maxSize: 10, ttlMs: 60_000 });
    const pipeline = new MiddlewarePipeline().use(mw);

    const ctx = makeCtx();
    const handler = async () => {
      callCount++;
      return makeResponse({ content: "fresh" });
    };

    // First call — cache miss
    await pipeline.execute(ctx, handler);
    expect(callCount).toBe(1);

    // Second call with same messages — cache hit
    const result = await pipeline.execute(makeCtx(), handler);
    expect(callCount).toBe(1); // handler not called again
    expect(result.content).toBe("fresh");
    expect(result.metadata.cacheHit).toBe(true);
  });

  test("different messages produce different cache keys", async () => {
    let callCount = 0;
    const mw = cachingMiddleware({ maxSize: 10, ttlMs: 60_000 });
    const pipeline = new MiddlewarePipeline().use(mw);

    const handler = async () => {
      callCount++;
      return makeResponse({ content: `response-${callCount}` });
    };

    await pipeline.execute(makeCtx({ messages: [{ role: "user", content: "A" }] }), handler);
    await pipeline.execute(makeCtx({ messages: [{ role: "user", content: "B" }] }), handler);

    expect(callCount).toBe(2);
  });

  test("expired cache entry triggers a fresh call", async () => {
    let callCount = 0;
    const mw = cachingMiddleware({ maxSize: 10, ttlMs: 50 });
    const pipeline = new MiddlewarePipeline().use(mw);

    const handler = async () => {
      callCount++;
      return makeResponse({ content: `v${callCount}` });
    };

    // First call
    await pipeline.execute(makeCtx(), handler);
    expect(callCount).toBe(1);

    // Wait for TTL to expire
    await new Promise((resolve) => setTimeout(resolve, 80));

    // Should be a cache miss now
    const result = await pipeline.execute(makeCtx(), handler);
    expect(callCount).toBe(2);
    expect(result.content).toBe("v2");
  });

  test("respects maxSize — evicts oldest entries", async () => {
    let callCount = 0;
    const mw = cachingMiddleware({ maxSize: 2, ttlMs: 60_000 });
    const pipeline = new MiddlewarePipeline().use(mw);

    const handler = async () => {
      callCount++;
      return makeResponse({ content: `r${callCount}` });
    };

    // Fill cache with 2 entries: cache = [A, B]
    await pipeline.execute(makeCtx({ messages: [{ role: "user", content: "A" }] }), handler);
    await pipeline.execute(makeCtx({ messages: [{ role: "user", content: "B" }] }), handler);
    expect(callCount).toBe(2);

    // Add a 3rd entry — evicts "A": cache = [B, C]
    await pipeline.execute(makeCtx({ messages: [{ role: "user", content: "C" }] }), handler);
    expect(callCount).toBe(3);

    // "A" should be a cache miss now
    await pipeline.execute(makeCtx({ messages: [{ role: "user", content: "A" }] }), handler);
    expect(callCount).toBe(4);

    // "C" should still be a cache hit (it was the most recent before "A" was re-added)
    await pipeline.execute(makeCtx({ messages: [{ role: "user", content: "C" }] }), handler);
    expect(callCount).toBe(4); // no new call
  });

  test("does not cache empty content responses", async () => {
    let callCount = 0;
    const mw = cachingMiddleware({ maxSize: 10, ttlMs: 60_000 });
    const pipeline = new MiddlewarePipeline().use(mw);

    const handler = async () => {
      callCount++;
      return makeResponse({ content: "" });
    };

    await pipeline.execute(makeCtx(), handler);
    await pipeline.execute(makeCtx(), handler);

    // Both calls should hit the handler since empty content is not cached
    expect(callCount).toBe(2);
  });
});

// ============================================================================
// COST RECORDER MIDDLEWARE
// ============================================================================

describe("costRecorderMiddleware", () => {
  test("records usage after successful response", async () => {
    const records: unknown[] = [];
    const tracker = { recordUsage: (r: unknown) => records.push(r) };
    const mw = costRecorderMiddleware(tracker);
    const pipeline = new MiddlewarePipeline().use(mw);

    await pipeline.execute(makeCtx(), makeFinalHandler());

    expect(records.length).toBe(1);
    expect(records[0]).toEqual({
      taskType: "unknown",
      modelId: "claude-haiku-4-5-20251001",
      tier: "fast",
      inputTokens: 10,
      outputTokens: 5,
    });
  });

  test("extracts taskType from ctx.metadata", async () => {
    const records: unknown[] = [];
    const tracker = { recordUsage: (r: unknown) => records.push(r) };
    const mw = costRecorderMiddleware(tracker);
    const pipeline = new MiddlewarePipeline().use(mw);

    await pipeline.execute(
      makeCtx({ metadata: { taskType: "summarization" } }),
      makeFinalHandler(),
    );

    expect((records[0] as { taskType: string }).taskType).toBe("summarization");
  });

  test("defaults taskType to 'unknown' when not set", async () => {
    const records: unknown[] = [];
    const tracker = { recordUsage: (r: unknown) => records.push(r) };
    const mw = costRecorderMiddleware(tracker);
    const pipeline = new MiddlewarePipeline().use(mw);

    await pipeline.execute(makeCtx(), makeFinalHandler());

    expect((records[0] as { taskType: string }).taskType).toBe("unknown");
  });

  test("does not record when next() throws", async () => {
    const records: unknown[] = [];
    const tracker = { recordUsage: (r: unknown) => records.push(r) };
    const mw = costRecorderMiddleware(tracker);
    const pipeline = new MiddlewarePipeline().use(mw);

    await expect(
      pipeline.execute(makeCtx(), async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(records.length).toBe(0);
  });

  test("records correct usage values from response", async () => {
    const records: unknown[] = [];
    const tracker = { recordUsage: (r: unknown) => records.push(r) };
    const mw = costRecorderMiddleware(tracker);
    const pipeline = new MiddlewarePipeline().use(mw);

    await pipeline.execute(
      makeCtx(),
      makeFinalHandler(
        makeResponse({
          modelId: "claude-sonnet-4-20250514",
          tier: "quality",
          usage: { inputTokens: 500, outputTokens: 250 },
        }),
      ),
    );

    expect(records[0]).toEqual({
      taskType: "unknown",
      modelId: "claude-sonnet-4-20250514",
      tier: "quality",
      inputTokens: 500,
      outputTokens: 250,
    });
  });
});

// ============================================================================
// INTEGRATION — COMPOSING MULTIPLE MIDDLEWARE
// ============================================================================

describe("middleware composition", () => {
  test("logging + retry + timeout compose correctly", async () => {
    const logs: string[] = [];
    let attempts = 0;

    const pipeline = new MiddlewarePipeline()
      .use(loggingMiddleware((msg) => logs.push(msg)))
      .use(retryMiddleware({ maxRetries: 1, backoffMs: 1 }))
      .use(timeoutMiddleware(5000));

    const result = await pipeline.execute(makeCtx(), async () => {
      attempts++;
      if (attempts === 1) throw new Error("transient");
      return makeResponse({ content: "recovered" });
    });

    expect(result.content).toBe("recovered");
    expect(attempts).toBe(2);
    expect(logs.length).toBe(2); // request + response
  });

  test("caching short-circuits retry and timeout", async () => {
    let handlerCalls = 0;

    const pipeline = new MiddlewarePipeline()
      .use(cachingMiddleware({ maxSize: 10, ttlMs: 60_000 }))
      .use(retryMiddleware({ maxRetries: 2, backoffMs: 1 }))
      .use(timeoutMiddleware(5000));

    const ctx = makeCtx();
    const handler = async () => {
      handlerCalls++;
      return makeResponse({ content: "hello" });
    };

    // First call — full pipeline
    await pipeline.execute(ctx, handler);
    expect(handlerCalls).toBe(1);

    // Second call — cache hit, retry and timeout never invoked
    const result = await pipeline.execute(makeCtx(), handler);
    expect(handlerCalls).toBe(1);
    expect(result.metadata.cacheHit).toBe(true);
  });

  test("cost recorder captures usage even with other middleware", async () => {
    const records: unknown[] = [];
    const tracker = { recordUsage: (r: unknown) => records.push(r) };

    const pipeline = new MiddlewarePipeline()
      .use(costRecorderMiddleware(tracker))
      .use(retryMiddleware({ maxRetries: 1, backoffMs: 1 }));

    let attempts = 0;
    await pipeline.execute(makeCtx({ metadata: { taskType: "chat" } }), async () => {
      attempts++;
      if (attempts === 1) throw new Error("transient");
      return makeResponse();
    });

    expect(records.length).toBe(1);
    expect((records[0] as { taskType: string }).taskType).toBe("chat");
  });

  test("full pipeline: logging -> caching -> cost -> retry -> timeout", async () => {
    const logs: string[] = [];
    const records: unknown[] = [];
    const tracker = { recordUsage: (r: unknown) => records.push(r) };
    let handlerCalls = 0;

    const pipeline = new MiddlewarePipeline()
      .use(loggingMiddleware((msg) => logs.push(msg)))
      .use(cachingMiddleware({ maxSize: 10, ttlMs: 60_000 }))
      .use(costRecorderMiddleware(tracker))
      .use(retryMiddleware({ maxRetries: 1, backoffMs: 1 }))
      .use(timeoutMiddleware(5000));

    const handler = async () => {
      handlerCalls++;
      return makeResponse({ content: "full pipeline" });
    };

    // First call — everything runs
    const r1 = await pipeline.execute(makeCtx(), handler);
    expect(r1.content).toBe("full pipeline");
    expect(handlerCalls).toBe(1);
    expect(logs.length).toBe(2);
    expect(records.length).toBe(1);

    // Second call — cached, cost recorder and below never run
    const r2 = await pipeline.execute(makeCtx(), handler);
    expect(r2.metadata.cacheHit).toBe(true);
    expect(handlerCalls).toBe(1); // not called again
    expect(logs.length).toBe(4); // 2 more logs (request + response for 2nd call)
    expect(records.length).toBe(1); // cost not recorded for cached response
  });
});
