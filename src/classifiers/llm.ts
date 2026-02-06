/**
 * ModelGate — LLM-powered classifier
 *
 * Uses a fast, cheap model (Haiku by default) to classify message complexity.
 * Results are cached in an LRU cache keyed by a hash of the message text.
 * Falls back to a "quality" tier result on any error (timeout, parse, API).
 */

import type { ClassificationResult, ModelTier } from "../types.js";
import { getDefaultModel } from "../registry/models.js";
import { LRUCache } from "../utils/cache.js";

// ============================================================================
// Configuration
// ============================================================================

export interface LLMClassifierConfig {
  /** Anthropic API key */
  apiKey: string;
  /** Model to use for classification (default: claude-haiku-4-5-20251001) */
  classifierModel?: string;
  /** Maximum cache entries (default: 1000) */
  cacheSize?: number;
  /** Timeout in milliseconds (default: 2000) */
  timeoutMs?: number;
}

// ============================================================================
// System prompt
// ============================================================================

const CLASSIFIER_SYSTEM_PROMPT = `You are a message complexity classifier. Respond with exactly one JSON object: {"tier":"fast"|"quality"|"expert","confidence":0.0-1.0}

FAST = factual lookup, greeting, simple question, acknowledgment, single-step request
QUALITY = multi-step request, comparison, planning, content generation, moderate analysis
EXPERT = complex multi-factor reasoning, strategy, financial/legal analysis, creative synthesis

Respond ONLY with the JSON object, nothing else.`;

// ============================================================================
// Hash function — FNV-1a (32-bit)
// ============================================================================

function fnv1aHash(str: string): string {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    // FNV prime: multiply by 16777619 using bit math to stay in 32-bit range
    hash = Math.imul(hash, 0x01000193);
  }
  // Convert to unsigned 32-bit and return as hex string
  return (hash >>> 0).toString(16);
}

// ============================================================================
// LLM Classifier
// ============================================================================

interface ClassifierResponse {
  tier: ModelTier;
  confidence: number;
}

export class LLMClassifier {
  private readonly apiKey: string;
  private readonly classifierModel: string;
  private readonly cache: LRUCache<string, ClassificationResult>;
  private readonly maxCacheSize: number;
  private readonly timeoutMs: number;

  constructor(config: LLMClassifierConfig) {
    this.apiKey = config.apiKey;
    this.classifierModel = config.classifierModel ?? "claude-haiku-4-5-20251001";
    this.maxCacheSize = config.cacheSize ?? 1000;
    this.cache = new LRUCache<string, ClassificationResult>(this.maxCacheSize);
    this.timeoutMs = config.timeoutMs ?? 2000;
  }

  /**
   * Classify a message using the LLM.
   * Returns a cached result if available, otherwise calls the API.
   */
  async classify(message: string): Promise<ClassificationResult> {
    const cacheKey = fnv1aHash(message);

    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const result = await this.callClassifier(message);
      this.cache.set(cacheKey, result);
      return result;
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : String(error);
      return this.buildFallbackResult(`llm-classifier-error: ${reason}`);
    }
  }

  /**
   * Clear the classification cache.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics.
   */
  get cacheStats(): { size: number; maxSize: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxCacheSize,
    };
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private async callClassifier(message: string): Promise<ClassificationResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.classifierModel,
          max_tokens: 50,
          system: CLASSIFIER_SYSTEM_PROMPT,
          messages: [{ role: "user", content: message }],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`API returned ${response.status}: ${body}`);
      }

      const data = (await response.json()) as {
        content: Array<{ type: string; text: string }>;
      };

      const text = data.content?.[0]?.text;
      if (!text) {
        throw new Error("Empty response from classifier API");
      }

      const parsed = this.parseClassifierResponse(text);
      const model = getDefaultModel(parsed.tier);

      return {
        tier: parsed.tier,
        modelId: model.id,
        score: parsed.confidence,
        reasons: [`LLM classifier: tier=${parsed.tier}, confidence=${parsed.confidence}`],
        classifierUsed: true,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private parseClassifierResponse(text: string): ClassifierResponse {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text.trim());
    } catch {
      throw new Error(`Failed to parse classifier JSON: ${text}`);
    }

    const obj = parsed as Record<string, unknown>;

    const tier = obj.tier;
    if (tier !== "fast" && tier !== "quality" && tier !== "expert") {
      throw new Error(`Invalid tier in classifier response: ${String(tier)}`);
    }

    const confidence = Number(obj.confidence);
    if (Number.isNaN(confidence) || confidence < 0 || confidence > 1) {
      throw new Error(`Invalid confidence in classifier response: ${String(obj.confidence)}`);
    }

    return { tier, confidence };
  }

  private buildFallbackResult(reason: string): ClassificationResult {
    const model = getDefaultModel("quality");
    return {
      tier: "quality",
      modelId: model.id,
      score: 0.5,
      reasons: [reason],
      classifierUsed: true,
    };
  }
}
