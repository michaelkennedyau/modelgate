/**
 * ModelGate — Barrel exports
 *
 * Public API surface for the modelgate package.
 */

// ── Main class ───────────────────────────────────────────────────────────
export { ModelGate } from "./gate.js";

// ── Types ────────────────────────────────────────────────────────────────
export type {
  ModelTier,
  Provider,
  ModelSpec,
  ClassificationResult,
  ClassifyInput,
  UsageRecord,
  CostStats,
  ModelGateConfig,
  // v0.2 types
  Middleware,
  RequestContext,
  ResponseContext,
  ChatRequest,
  ChatResponse,
  StreamChunk,
  ProviderAdapter,
  ProviderConfig,
  ProviderConfigs,
  Experiment,
  ExperimentVariant,
  ExperimentAssignment,
} from "./types.js";

export { DEFAULT_TASK_TIERS } from "./types.js";

// ── Registry ─────────────────────────────────────────────────────────────
export {
  MODEL_REGISTRY,
  getModelsByTier,
  getModelsByProvider,
  getDefaultModel,
  registerModel,
} from "./registry/models.js";

export { getTaskTier } from "./registry/defaults.js";

// ── Classifiers ──────────────────────────────────────────────────────────
export { classifyHeuristic } from "./classifiers/heuristic.js";
export { classifyTask } from "./classifiers/task.js";

// ── Middleware (v0.2) ────────────────────────────────────────────────────
export { MiddlewarePipeline } from "./middleware/pipeline.js";
export {
  loggingMiddleware,
  retryMiddleware,
  timeoutMiddleware,
  cachingMiddleware,
  costRecorderMiddleware,
} from "./middleware/builtins.js";

// ── Providers (v0.2) ────────────────────────────────────────────────────
export { createProvider } from "./providers/base.js";
export { AnthropicAdapter } from "./providers/anthropic.js";
export { OpenAIAdapter } from "./providers/openai.js";
export { GoogleAdapter } from "./providers/google.js";

// ── A/B Testing (v0.2) ──────────────────────────────────────────────────
export { ExperimentManager } from "./ab/experiment.js";

// ── Utils ────────────────────────────────────────────────────────────────
export { getEnvConfig } from "./utils/env.js";
