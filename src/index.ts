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

// ── Utils ────────────────────────────────────────────────────────────────
export { getEnvConfig } from "./utils/env.js";
