/**
 * ModelGate — Built-in Middleware
 *
 * Factory functions for common middleware patterns:
 * logging, retry, timeout, caching, and cost recording.
 */

import type { Middleware, ResponseContext } from "../types.js";
import { LRUCache } from "../utils/cache.js";

// ============================================================================
// LOGGING
// ============================================================================

/**
 * Logs request classification and response timing.
 *
 * @param logger - Custom logger function (default: console.log)
 */
export function loggingMiddleware(logger?: (msg: string) => void): Middleware {
  const log = logger ?? console.log;

  return async (ctx, next) => {
    const { tier, modelId } = ctx.classification;
    log(`[modelgate] request tier=${tier} model=${modelId}`);

    const start = Date.now();
    const response = await next();
    const elapsed = Date.now() - start;

    log(`[modelgate] response model=${response.modelId} latency=${elapsed}ms`);
    return response;
  };
}

// ============================================================================
// RETRY
// ============================================================================

export interface RetryOptions {
  /** Maximum number of retries after the initial attempt (default: 2) */
  maxRetries?: number;
  /** Initial backoff delay in milliseconds (default: 100). Doubles each retry. */
  backoffMs?: number;
}

/**
 * Retries the downstream call on error with exponential backoff.
 * Respects AbortSignal — stops retrying if the signal is aborted.
 *
 * @param options - Retry configuration
 */
export function retryMiddleware(options?: RetryOptions): Middleware {
  const maxRetries = options?.maxRetries ?? 2;
  const baseBackoff = options?.backoffMs ?? 100;

  return async (ctx, next) => {
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // Check abort signal before each attempt
      if (ctx.signal?.aborted) {
        throw new Error("Request aborted");
      }

      try {
        return await next();
      } catch (err) {
        lastError = err;

        // Don't retry if aborted
        if (ctx.signal?.aborted) {
          throw err;
        }

        // Don't wait after the last attempt
        if (attempt < maxRetries) {
          const delay = baseBackoff * 2 ** attempt;
          await sleep(delay, ctx.signal);
        }
      }
    }

    throw lastError;
  };
}

/**
 * Sleep helper that respects AbortSignal.
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Request aborted"));
      return;
    }

    const timer = setTimeout(resolve, ms);

    if (signal) {
      const onAbort = () => {
        clearTimeout(timer);
        reject(new Error("Request aborted"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

// ============================================================================
// TIMEOUT
// ============================================================================

/**
 * Wraps the downstream call in a timeout.
 * Throws a descriptive error if the timeout is exceeded.
 *
 * @param ms - Timeout in milliseconds (default: 30000)
 */
export function timeoutMiddleware(ms?: number): Middleware {
  const timeoutMs = ms ?? 30_000;

  return async (ctx, next) => {
    return new Promise<ResponseContext>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Middleware timeout: request exceeded ${timeoutMs}ms`));
      }, timeoutMs);

      next()
        .then((response) => {
          clearTimeout(timer);
          resolve(response);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  };
}

// ============================================================================
// CACHING
// ============================================================================

export interface CachingOptions {
  /** Maximum number of cached entries (default: 500) */
  maxSize?: number;
  /** Time-to-live in milliseconds (default: 300000 / 5 minutes) */
  ttlMs?: number;
}

interface CacheEntry {
  response: ResponseContext;
  expiresAt: number;
}

/**
 * LRU cache keyed on message content. Only caches successful responses.
 *
 * @param options - Cache configuration
 */
export function cachingMiddleware(options?: CachingOptions): Middleware {
  const maxSize = options?.maxSize ?? 500;
  const ttlMs = options?.ttlMs ?? 5 * 60 * 1000;
  const cache = new LRUCache<string, CacheEntry>(maxSize);

  return async (ctx, next) => {
    const key = buildCacheKey(ctx.messages);
    const cached = cache.get(key);

    if (cached && cached.expiresAt > Date.now()) {
      return { ...cached.response, metadata: { ...cached.response.metadata, cacheHit: true } };
    }

    const response = await next();

    // Only cache successful responses (has content and no error metadata)
    if (response.content) {
      cache.set(key, {
        response,
        expiresAt: Date.now() + ttlMs,
      });
    }

    return response;
  };
}

/**
 * Build a deterministic cache key from conversation messages.
 */
function buildCacheKey(messages: Array<{ role: string; content: string }>): string {
  return messages.map((m) => `${m.role}:${m.content}`).join("|");
}

// ============================================================================
// COST RECORDER
// ============================================================================

export interface CostTracker {
  recordUsage: (record: {
    taskType: string;
    modelId: string;
    tier: string;
    inputTokens: number;
    outputTokens: number;
  }) => void;
}

/**
 * After next() returns, records token usage to the provided tracker.
 * Extracts taskType from ctx.metadata.taskType or defaults to "unknown".
 *
 * @param tracker - Object with a recordUsage method
 */
export function costRecorderMiddleware(tracker: CostTracker): Middleware {
  return async (ctx, next) => {
    const response = await next();

    const taskType = (ctx.metadata.taskType as string) ?? "unknown";

    tracker.recordUsage({
      taskType,
      modelId: response.modelId,
      tier: response.tier,
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
    });

    return response;
  };
}
