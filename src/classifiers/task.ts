/**
 * ModelGate — Task type classifier
 *
 * Maps task type strings to their configured tiers using
 * DEFAULT_TASK_TIERS with optional overrides.
 */

import type { ClassificationResult, ModelTier } from "../types.js";
import { getTaskTier } from "../registry/defaults.js";
import { getDefaultModel } from "../registry/models.js";

/**
 * Classify a task type into a tier and return the default model for that tier.
 *
 * @param taskType - A task type string (e.g., "summarization", "strategy")
 * @param overrides - Optional tier overrides for specific task types
 * @returns Classification result with tier, model, and reasons
 */
export function classifyTask(
  taskType: string,
  overrides?: Record<string, ModelTier>,
): ClassificationResult {
  const tier = getTaskTier(taskType, overrides);
  const model = getDefaultModel(tier);
  const reasons: string[] = [];

  if (overrides?.[taskType]) {
    reasons.push(`Task "${taskType}" overridden to tier "${tier}"`);
  } else {
    reasons.push(`Task "${taskType}" mapped to default tier "${tier}"`);
  }

  return {
    tier,
    modelId: model.id,
    score: tier === "fast" ? 0.1 : tier === "quality" ? 0.5 : 0.9,
    reasons,
    classifierUsed: false,
  };
}
