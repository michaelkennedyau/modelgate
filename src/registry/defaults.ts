/**
 * ModelGate — Default task tier mappings
 *
 * Re-exports DEFAULT_TASK_TIERS and provides a helper to resolve
 * a task type to its tier with optional overrides.
 */

import type { ModelTier } from "../types.js";
import { DEFAULT_TASK_TIERS } from "../types.js";

export { DEFAULT_TASK_TIERS };

/**
 * Resolve the tier for a given task type.
 * Overrides take precedence over defaults.
 * Falls back to "quality" for unknown task types.
 */
export function getTaskTier(
  taskType: string,
  overrides?: Record<string, ModelTier>,
): ModelTier {
  if (overrides?.[taskType]) {
    return overrides[taskType];
  }
  return DEFAULT_TASK_TIERS[taskType] ?? "quality";
}
