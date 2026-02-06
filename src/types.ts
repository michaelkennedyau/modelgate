/**
 * ModelGate — Core type definitions
 *
 * These types define the contract between all modules.
 * Changes here affect everything — keep them stable.
 */

// ============================================================================
// MODEL TIERS
// ============================================================================

/** The three cost tiers that every model maps to */
export type ModelTier = "fast" | "quality" | "expert";

/** Supported LLM providers */
export type Provider = "anthropic" | "openai" | "google" | "custom";

// ============================================================================
// MODEL REGISTRY
// ============================================================================

/** Full specification of a model in the registry */
export interface ModelSpec {
  /** Unique model identifier (e.g., 'claude-haiku-4-5-20251001') */
  id: string;
  /** Human-readable name */
  name: string;
  /** Cost tier */
  tier: ModelTier;
  /** Provider */
  provider: Provider;
  /** Cost per 1M input tokens (USD) */
  inputCostPer1M: number;
  /** Cost per 1M output tokens (USD) */
  outputCostPer1M: number;
  /** Maximum context window (tokens) */
  maxTokens: number;
  /** Supports vision/image input */
  vision?: boolean;
}

// ============================================================================
// CLASSIFICATION
// ============================================================================

/** Result of classifying a message or task */
export interface ClassificationResult {
  /** Which cost tier to use */
  tier: ModelTier;
  /** Specific model ID to use */
  modelId: string;
  /** Confidence score 0.0-1.0 */
  score: number;
  /** Human-readable reasons for the decision */
  reasons: string[];
  /** Whether the LLM classifier was invoked */
  classifierUsed?: boolean;
}

/** Input for message-based classification */
export interface ClassifyInput {
  /** The message text to classify */
  message: string;
  /** Full conversation messages (for context-aware classification) */
  messages?: Array<{ role: string; content?: string | unknown }>;
}

// ============================================================================
// COST TRACKING
// ============================================================================

/** Record of a single API call's token usage */
export interface UsageRecord {
  /** Task type or label */
  taskType: string;
  /** Model used */
  modelId: string;
  /** Tier used */
  tier: ModelTier;
  /** Input tokens consumed */
  inputTokens: number;
  /** Output tokens consumed */
  outputTokens: number;
  /** Timestamp */
  timestamp: number;
}

/** Aggregated cost statistics */
export interface CostStats {
  /** Total API calls tracked */
  totalCalls: number;
  /** Total cost in USD */
  totalCost: number;
  /** Breakdown by tier */
  byTier: Record<ModelTier, { calls: number; cost: number }>;
  /** Breakdown by task type */
  byTaskType: Record<string, { calls: number; cost: number }>;
  /** Estimated savings vs all-quality tier */
  savedVsAllQuality: number;
  /** Estimated savings vs all-expert tier */
  savedVsAllExpert: number;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

/** Full ModelGate configuration */
export interface ModelGateConfig {
  /** API key for intelligent classification (Anthropic) */
  apiKey?: string;

  /** Enable LLM-powered classification for ambiguous messages */
  intelligent?: boolean;

  /** Score threshold — below = fast, at or above = quality/expert (default: 0.4) */
  threshold?: number;

  /** Ambiguity band — scores in this range trigger LLM classifier (default: [0.3, 0.7]) */
  ambiguityBand?: [number, number];

  /** Default provider preference order */
  providerPreference?: Provider[];

  /** Enable cost tracking (default: false) */
  tracking?: boolean;

  /** Task type → tier overrides */
  taskOverrides?: Record<string, ModelTier>;

  /** Custom heuristic patterns to extend defaults */
  customPatterns?: {
    simple?: RegExp[];
    complex?: RegExp[];
  };

  /** Force all traffic to one tier (emergency override) */
  forceModel?: ModelTier;

  /** Model to use for LLM classifier (default: cheapest fast-tier model) */
  classifierModel?: string;

  /** LRU cache size for classifier results (default: 1000) */
  classifierCacheSize?: number;

  /** Custom models to add to registry */
  customModels?: ModelSpec[];
}

// ============================================================================
// DEFAULT TASK TYPES
// ============================================================================

/**
 * Common task types with sensible default tier mappings.
 * Users can override any of these via taskOverrides.
 */
export const DEFAULT_TASK_TIERS: Record<string, ModelTier> = {
  // Fast tier — classification, extraction, simple Q&A
  classification: "fast",
  extraction: "fast",
  sentiment_analysis: "fast",
  entity_extraction: "fast",
  summarization: "fast",
  translation: "fast",
  formatting: "fast",
  tagging: "fast",

  // Quality tier — generation, teaching, analysis
  content_generation: "quality",
  chat: "quality",
  code_generation: "quality",
  explanation: "quality",
  comparison: "quality",
  planning: "quality",
  editing: "quality",
  research: "quality",

  // Expert tier — complex reasoning, strategy, critical analysis
  financial_analysis: "expert",
  legal_analysis: "expert",
  strategy: "expert",
  architecture: "expert",
  audit: "expert",
  complex_reasoning: "expert",
};
