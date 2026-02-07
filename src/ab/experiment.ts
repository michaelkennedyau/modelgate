/**
 * ModelGate — A/B Testing Engine
 *
 * Manages experiments that route traffic between different model tiers
 * to measure cost vs quality tradeoffs. Uses weighted random selection
 * to assign requests to experiment variants.
 */

import { getDefaultModel } from "../registry/models.js";
import type { Experiment, ExperimentAssignment, ExperimentVariant, ModelTier } from "../types.js";

/** Valid tier values for validation */
const VALID_TIERS: ModelTier[] = ["fast", "quality", "expert"];

/**
 * Select a variant using weighted random selection.
 * Walks through variants accumulating weights until Math.random() falls
 * within the cumulative range. Assumes weights sum to ~1.0.
 */
export function selectVariant(variants: ExperimentVariant[]): ExperimentVariant {
  if (variants.length === 0) {
    throw new Error("Cannot select from empty variants array");
  }

  if (variants.length === 1) {
    return variants[0];
  }

  const roll = Math.random();
  let cumulative = 0;

  for (const variant of variants) {
    cumulative += variant.weight;
    if (roll < cumulative) {
      return variant;
    }
  }

  // Floating-point edge case: return the last variant
  return variants[variants.length - 1];
}

export class ExperimentManager {
  private experiments: Map<string, Experiment> = new Map();
  private assignments: ExperimentAssignment[] = [];

  /**
   * Register an experiment. If an experiment with the same name already
   * exists, it will be overwritten.
   */
  addExperiment(experiment: Experiment): void {
    this.experiments.set(experiment.name, experiment);
  }

  /** Remove an experiment by name. No-op if the experiment does not exist. */
  removeExperiment(name: string): void {
    this.experiments.delete(name);
  }

  /** Get an experiment by name. Returns undefined if not found. */
  getExperiment(name: string): Experiment | undefined {
    return this.experiments.get(name);
  }

  /** List all registered experiments. */
  listExperiments(): Experiment[] {
    return Array.from(this.experiments.values());
  }

  /**
   * Activate or deactivate an experiment.
   * Throws if the experiment does not exist.
   */
  setActive(name: string, active: boolean): void {
    const experiment = this.experiments.get(name);
    if (!experiment) {
      throw new Error(`Experiment "${name}" not found`);
    }
    experiment.active = active;
  }

  /**
   * Assign a request to an experiment variant.
   * Uses weighted random selection based on variant weights.
   * Returns undefined if experiment not found or not active.
   * Records the assignment for later analysis.
   */
  assign(experimentName: string): ExperimentAssignment | undefined {
    const experiment = this.experiments.get(experimentName);
    if (!experiment || !experiment.active) {
      return undefined;
    }

    const variant = selectVariant(experiment.variants);
    const model = getDefaultModel(variant.tier);

    const assignment: ExperimentAssignment = {
      experimentName,
      variantName: variant.name,
      tier: variant.tier,
      modelId: model.id,
    };

    this.assignments.push(assignment);
    return assignment;
  }

  /**
   * Get all recorded assignments, optionally filtered by experiment name.
   */
  getAssignments(experimentName?: string): ExperimentAssignment[] {
    if (experimentName === undefined) {
      return [...this.assignments];
    }
    return this.assignments.filter((a) => a.experimentName === experimentName);
  }

  /**
   * Get distribution stats for an experiment.
   * Returns the actual percentage of traffic each variant received.
   * Returns undefined if the experiment does not exist.
   */
  getDistribution(
    experimentName: string,
  ): Record<string, { count: number; percentage: number }> | undefined {
    const experiment = this.experiments.get(experimentName);
    if (!experiment) {
      return undefined;
    }

    const experimentAssignments = this.assignments.filter(
      (a) => a.experimentName === experimentName,
    );
    const total = experimentAssignments.length;

    const distribution: Record<string, { count: number; percentage: number }> = {};

    // Initialize all variant entries with zero counts
    for (const variant of experiment.variants) {
      distribution[variant.name] = { count: 0, percentage: 0 };
    }

    // Count assignments per variant
    for (const assignment of experimentAssignments) {
      if (distribution[assignment.variantName]) {
        distribution[assignment.variantName].count += 1;
      } else {
        // Assignment for a variant that no longer exists in the experiment
        distribution[assignment.variantName] = { count: 1, percentage: 0 };
      }
    }

    // Calculate percentages
    if (total > 0) {
      for (const key of Object.keys(distribution)) {
        distribution[key].percentage = distribution[key].count / total;
      }
    }

    return distribution;
  }

  /** Clear all recorded assignments. */
  clearAssignments(): void {
    this.assignments = [];
  }

  /**
   * Validate an experiment definition.
   * Checks:
   * - At least 1 variant
   * - All weights > 0
   * - Weights sum to ~1.0 (within +/-0.01 tolerance)
   * - No duplicate variant names
   * - All tier values are valid
   */
  static validate(experiment: Experiment): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check for at least 1 variant
    if (!experiment.variants || experiment.variants.length === 0) {
      errors.push("Experiment must have at least 1 variant");
      return { valid: false, errors };
    }

    // Check all weights > 0
    for (const variant of experiment.variants) {
      if (variant.weight <= 0) {
        errors.push(`Variant "${variant.name}" has weight ${variant.weight} — must be > 0`);
      }
    }

    // Check weights sum to ~1.0
    const weightSum = experiment.variants.reduce((sum, v) => sum + v.weight, 0);
    if (Math.abs(weightSum - 1.0) > 0.01) {
      errors.push(`Variant weights sum to ${weightSum.toFixed(4)} — must be within 0.01 of 1.0`);
    }

    // Check for duplicate variant names
    const names = new Set<string>();
    for (const variant of experiment.variants) {
      if (names.has(variant.name)) {
        errors.push(`Duplicate variant name: "${variant.name}"`);
      }
      names.add(variant.name);
    }

    // Check valid tier values
    for (const variant of experiment.variants) {
      if (!VALID_TIERS.includes(variant.tier)) {
        errors.push(
          `Variant "${variant.name}" has invalid tier "${variant.tier}" — must be one of: ${VALID_TIERS.join(", ")}`,
        );
      }
    }

    return { valid: errors.length === 0, errors };
  }
}
