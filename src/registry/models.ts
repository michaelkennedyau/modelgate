/**
 * ModelGate — Built-in model registry
 *
 * Contains pricing and capabilities for all supported models.
 * Users can extend this via registerModel().
 */

import type { ModelSpec, ModelTier, Provider } from "../types.js";

/** All built-in models indexed by model ID */
export const MODEL_REGISTRY: Record<string, ModelSpec> = {
  // ── Anthropic ──────────────────────────────────────────────────────────
  "claude-haiku-4-5-20251001": {
    id: "claude-haiku-4-5-20251001",
    name: "Claude Haiku 4.5",
    tier: "fast",
    provider: "anthropic",
    inputCostPer1M: 1,
    outputCostPer1M: 5,
    maxTokens: 200_000,
    vision: true,
  },
  "claude-sonnet-4-5-20250929": {
    id: "claude-sonnet-4-5-20250929",
    name: "Claude Sonnet 4.5",
    tier: "quality",
    provider: "anthropic",
    inputCostPer1M: 3,
    outputCostPer1M: 15,
    maxTokens: 200_000,
    vision: true,
  },
  "claude-opus-4-6": {
    id: "claude-opus-4-6",
    name: "Claude Opus 4.6",
    tier: "expert",
    provider: "anthropic",
    inputCostPer1M: 5,
    outputCostPer1M: 25,
    maxTokens: 200_000,
    vision: true,
  },

  // ── OpenAI ─────────────────────────────────────────────────────────────
  "gpt-4o-mini": {
    id: "gpt-4o-mini",
    name: "GPT-4o Mini",
    tier: "fast",
    provider: "openai",
    inputCostPer1M: 0.15,
    outputCostPer1M: 0.6,
    maxTokens: 128_000,
    vision: true,
  },
  "gpt-4o": {
    id: "gpt-4o",
    name: "GPT-4o",
    tier: "quality",
    provider: "openai",
    inputCostPer1M: 2.5,
    outputCostPer1M: 10,
    maxTokens: 128_000,
    vision: true,
  },
  o3: {
    id: "o3",
    name: "OpenAI o3",
    tier: "expert",
    provider: "openai",
    inputCostPer1M: 10,
    outputCostPer1M: 40,
    maxTokens: 200_000,
    vision: false,
  },

  // ── Google ─────────────────────────────────────────────────────────────
  "gemini-2.5-flash": {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    tier: "fast",
    provider: "google",
    inputCostPer1M: 0.15,
    outputCostPer1M: 0.6,
    maxTokens: 1_000_000,
    vision: true,
  },
  "gemini-2.5-pro": {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    tier: "quality",
    provider: "google",
    inputCostPer1M: 1.25,
    outputCostPer1M: 10,
    maxTokens: 1_000_000,
    vision: true,
  },
};

/** Default provider preference order for tier lookups */
const DEFAULT_PROVIDER_PREFERENCE: Provider[] = ["anthropic", "openai", "google"];

/**
 * Get all models that belong to a given tier.
 */
export function getModelsByTier(tier: ModelTier): ModelSpec[] {
  return Object.values(MODEL_REGISTRY).filter((m) => m.tier === tier);
}

/**
 * Get all models from a given provider.
 */
export function getModelsByProvider(provider: Provider): ModelSpec[] {
  return Object.values(MODEL_REGISTRY).filter((m) => m.provider === provider);
}

/**
 * Get the default model for a tier, optionally scoped to a provider.
 * If no provider specified, uses Anthropic > OpenAI > Google preference order.
 */
export function getDefaultModel(tier: ModelTier, provider?: Provider): ModelSpec {
  const tierModels = getModelsByTier(tier);

  if (provider) {
    const match = tierModels.find((m) => m.provider === provider);
    if (match) return match;
  }

  // Walk preference order
  for (const pref of DEFAULT_PROVIDER_PREFERENCE) {
    const match = tierModels.find((m) => m.provider === pref);
    if (match) return match;
  }

  // Fallback: return the first model in the tier (shouldn't happen with built-ins)
  if (tierModels.length > 0) return tierModels[0];

  throw new Error(`No models registered for tier "${tier}"`);
}

/**
 * Register a custom model in the registry.
 * Overwrites any existing model with the same ID.
 */
export function registerModel(spec: ModelSpec): void {
  MODEL_REGISTRY[spec.id] = spec;
}
