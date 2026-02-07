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

  /** Provider API keys and config (v0.2) */
  providers?: ProviderConfigs;

  /** A/B experiments (v0.2) */
  experiments?: Experiment[];

  /** Default max output tokens for chat/stream (v0.2, default: 1024) */
  defaultMaxTokens?: number;

  /** Default temperature for chat/stream (v0.2) */
  defaultTemperature?: number;
}

// ============================================================================
// DEFAULT TASK TYPES
// ============================================================================

/**
 * Common task types with sensible default tier mappings.
 * Users can override any of these via taskOverrides.
 */
// ============================================================================
// MIDDLEWARE (v0.2)
// ============================================================================

/** Context passed through the middleware pipeline */
export interface RequestContext {
  /** Conversation messages */
  messages: Array<{ role: string; content: string }>;
  /** Classification result (set by ModelGate before middleware runs) */
  classification: ClassificationResult;
  /** System prompt to prepend */
  systemPrompt?: string;
  /** Max output tokens */
  maxTokens?: number;
  /** Temperature (0.0-1.0) */
  temperature?: number;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** Arbitrary metadata (middleware can read/write) */
  metadata: Record<string, unknown>;
}

/** Response from an LLM call */
export interface ResponseContext {
  /** Generated text content */
  content: string;
  /** Model that was actually used */
  modelId: string;
  /** Tier that was used */
  tier: ModelTier;
  /** Token usage */
  usage: { inputTokens: number; outputTokens: number };
  /** Stop reason */
  stopReason?: string;
  /** Latency in milliseconds */
  latencyMs?: number;
  /** Arbitrary metadata */
  metadata: Record<string, unknown>;
}

/** Middleware function — wraps the request/response pipeline */
export type Middleware = (
  ctx: RequestContext,
  next: () => Promise<ResponseContext>,
) => Promise<ResponseContext>;

// ============================================================================
// PROVIDER ADAPTERS (v0.2)
// ============================================================================

/** Unified chat request across all providers */
export interface ChatRequest {
  /** Model ID to use */
  model: string;
  /** Conversation messages */
  messages: Array<{ role: string; content: string }>;
  /** System prompt */
  systemPrompt?: string;
  /** Max output tokens (default: 1024) */
  maxTokens?: number;
  /** Temperature 0.0-1.0 (default: provider default) */
  temperature?: number;
  /** Abort signal */
  signal?: AbortSignal;
}

/** Unified chat response */
export interface ChatResponse {
  /** Generated content */
  content: string;
  /** Model that processed the request */
  modelId: string;
  /** Token usage */
  usage: { inputTokens: number; outputTokens: number };
  /** Why generation stopped */
  stopReason?: string;
}

/** A chunk from a streaming response */
export interface StreamChunk {
  /** Chunk type */
  type: "text" | "usage" | "done";
  /** Text content (for type=text) */
  text?: string;
  /** Token usage (for type=usage or type=done) */
  usage?: { inputTokens: number; outputTokens: number };
}

/** Provider adapter interface — implement for each LLM provider */
export interface ProviderAdapter {
  /** Provider name */
  readonly name: Provider;
  /** Send a chat request and get a complete response */
  chat(request: ChatRequest): Promise<ChatResponse>;
  /** Send a chat request and stream the response */
  stream(request: ChatRequest): AsyncIterable<StreamChunk>;
}

/** Configuration for a provider adapter */
export interface ProviderConfig {
  /** API key */
  apiKey: string;
  /** Base URL override */
  baseUrl?: string;
  /** Request timeout in ms (default: 30000) */
  timeout?: number;
}

// ============================================================================
// A/B TESTING (v0.2)
// ============================================================================

/** An experiment that routes traffic between tier variants */
export interface Experiment {
  /** Unique experiment name */
  name: string;
  /** Variant definitions with traffic weights */
  variants: ExperimentVariant[];
  /** Whether the experiment is active */
  active: boolean;
}

/** A variant in an A/B experiment */
export interface ExperimentVariant {
  /** Variant name (e.g., "control", "cheaper") */
  name: string;
  /** Tier to route to */
  tier: ModelTier;
  /** Traffic weight (0.0-1.0, all weights in experiment should sum to 1.0) */
  weight: number;
}

/** Result of assigning a request to an experiment variant */
export interface ExperimentAssignment {
  /** Experiment name */
  experimentName: string;
  /** Assigned variant name */
  variantName: string;
  /** Tier for this variant */
  tier: ModelTier;
  /** Model ID for this variant */
  modelId: string;
}

// ============================================================================
// EXTENDED CONFIG (v0.2)
// ============================================================================

/** Provider configurations keyed by provider name */
export type ProviderConfigs = Partial<Record<Provider, ProviderConfig>>;

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
