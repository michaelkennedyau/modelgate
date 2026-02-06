/**
 * ModelGate — Environment variable configuration
 *
 * Reads MODELGATE_* env vars and converts them to config overrides.
 * Environment variables take precedence over code-level config.
 */

import type { ModelGateConfig, ModelTier } from "../types.js";

const VALID_TIERS: ModelTier[] = ["fast", "quality", "expert"];

function isTier(value: string): value is ModelTier {
  return VALID_TIERS.includes(value as ModelTier);
}

/**
 * Parse MODELGATE_* environment variables into a partial config.
 *
 * Supported variables:
 * - MODELGATE_FORCE → forceModel (fast | quality | expert)
 * - MODELGATE_INTELLIGENT → intelligent (true | false | 1 | 0)
 * - MODELGATE_THRESHOLD → threshold (number 0-1)
 * - MODELGATE_CLASSIFIER_MODEL → classifierModel (string)
 */
export function getEnvConfig(): Partial<ModelGateConfig> {
  const config: Partial<ModelGateConfig> = {};

  const force = process.env.MODELGATE_FORCE;
  if (force && isTier(force)) {
    config.forceModel = force;
  }

  const intelligent = process.env.MODELGATE_INTELLIGENT;
  if (intelligent !== undefined) {
    config.intelligent = intelligent === "true" || intelligent === "1";
  }

  const threshold = process.env.MODELGATE_THRESHOLD;
  if (threshold !== undefined) {
    const parsed = Number.parseFloat(threshold);
    if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 1) {
      config.threshold = parsed;
    }
  }

  const classifierModel = process.env.MODELGATE_CLASSIFIER_MODEL;
  if (classifierModel) {
    config.classifierModel = classifierModel;
  }

  return config;
}
