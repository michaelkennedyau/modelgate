/**
 * ModelGate — Main entry point
 *
 * The ModelGate class ties together heuristic classification, task mapping,
 * optional LLM-powered classification, and cost tracking.
 */

import type {
  ClassificationResult,
  ClassifyInput,
  CostStats,
  ModelGateConfig,
  ModelSpec,
  ModelTier,
  UsageRecord,
} from "./types.js";
import { classifyHeuristic } from "./classifiers/heuristic.js";
import { classifyTask } from "./classifiers/task.js";
import { getDefaultModel, registerModel } from "./registry/models.js";
import { getEnvConfig } from "./utils/env.js";

export class ModelGate {
  private readonly config: ModelGateConfig;
  private usageRecords: UsageRecord[] = [];

  constructor(userConfig: ModelGateConfig = {}) {
    // Merge: env vars override user config
    const envConfig = getEnvConfig();
    this.config = { ...userConfig, ...envConfig };

    // Register any custom models
    if (this.config.customModels) {
      for (const model of this.config.customModels) {
        registerModel(model);
      }
    }
  }

  /**
   * Classify a message to determine the appropriate model tier.
   *
   * Accepts either a plain string or a ClassifyInput object.
   * If forceModel is set, always returns that tier.
   * If intelligent mode is on and the score falls in the ambiguity band,
   * attempts to use the LLM classifier (falls back to heuristic if unavailable).
   */
  classify(input: string | ClassifyInput): ClassificationResult {
    const classifyInput: ClassifyInput =
      typeof input === "string" ? { message: input } : input;

    // Force override: skip all classification
    if (this.config.forceModel) {
      const tier = this.config.forceModel;
      const model = getDefaultModel(tier);
      return {
        tier,
        modelId: model.id,
        score: tier === "fast" ? 0.0 : tier === "quality" ? 0.5 : 1.0,
        reasons: [`Forced to tier "${tier}" via config/env override`],
        classifierUsed: false,
      };
    }

    // Run heuristic classification
    const heuristicResult = classifyHeuristic(classifyInput, {
      threshold: this.config.threshold,
      simplePatterns: this.config.customPatterns?.simple,
      complexPatterns: this.config.customPatterns?.complex,
    });

    // Check if intelligent mode should upgrade the classification
    if (this.config.intelligent && this.config.apiKey) {
      const band = this.config.ambiguityBand ?? [0.3, 0.7];
      if (heuristicResult.score >= band[0] && heuristicResult.score <= band[1]) {
        // In the ambiguity band — would delegate to LLM classifier here.
        // Since the LLM classifier module is not yet implemented, we annotate
        // the heuristic result to indicate the ambiguity was detected.
        heuristicResult.reasons.push(
          `Score ${heuristicResult.score.toFixed(2)} is in ambiguity band [${band[0]}, ${band[1]}] — LLM classifier not yet available, using heuristic result`,
        );
      }
    }

    return heuristicResult;
  }

  /**
   * Classify a task type to determine the appropriate model tier.
   * Uses DEFAULT_TASK_TIERS with any configured taskOverrides.
   */
  classifyTask(taskType: string): ClassificationResult {
    // Force override
    if (this.config.forceModel) {
      const tier = this.config.forceModel;
      const model = getDefaultModel(tier);
      return {
        tier,
        modelId: model.id,
        score: tier === "fast" ? 0.0 : tier === "quality" ? 0.5 : 1.0,
        reasons: [`Forced to tier "${tier}" via config/env override`],
        classifierUsed: false,
      };
    }

    return classifyTask(taskType, this.config.taskOverrides);
  }

  /**
   * Record token usage for cost tracking.
   * Only works if tracking is enabled in config.
   */
  recordUsage(record: Omit<UsageRecord, "timestamp">): void {
    if (!this.config.tracking) return;

    this.usageRecords.push({
      ...record,
      timestamp: Date.now(),
    });
  }

  /**
   * Get aggregated cost statistics.
   * Returns null if tracking is not enabled.
   */
  getStats(): CostStats | null {
    if (!this.config.tracking) return null;

    const stats: CostStats = {
      totalCalls: 0,
      totalCost: 0,
      byTier: {
        fast: { calls: 0, cost: 0 },
        quality: { calls: 0, cost: 0 },
        expert: { calls: 0, cost: 0 },
      },
      byTaskType: {},
      savedVsAllQuality: 0,
      savedVsAllExpert: 0,
    };

    // Reference costs for savings calculation
    const qualityModel = getDefaultModel("quality");
    const expertModel = getDefaultModel("expert");

    for (const record of this.usageRecords) {
      stats.totalCalls++;

      // Calculate actual cost
      let actualModel: ModelSpec;
      try {
        actualModel = getDefaultModel(record.tier);
      } catch {
        continue;
      }
      const actualCost =
        (record.inputTokens / 1_000_000) * actualModel.inputCostPer1M +
        (record.outputTokens / 1_000_000) * actualModel.outputCostPer1M;

      stats.totalCost += actualCost;
      stats.byTier[record.tier].calls++;
      stats.byTier[record.tier].cost += actualCost;

      // By task type
      if (!stats.byTaskType[record.taskType]) {
        stats.byTaskType[record.taskType] = { calls: 0, cost: 0 };
      }
      stats.byTaskType[record.taskType].calls++;
      stats.byTaskType[record.taskType].cost += actualCost;

      // Hypothetical cost if all-quality
      const qualityCost =
        (record.inputTokens / 1_000_000) * qualityModel.inputCostPer1M +
        (record.outputTokens / 1_000_000) * qualityModel.outputCostPer1M;
      stats.savedVsAllQuality += qualityCost - actualCost;

      // Hypothetical cost if all-expert
      const expertCost =
        (record.inputTokens / 1_000_000) * expertModel.inputCostPer1M +
        (record.outputTokens / 1_000_000) * expertModel.outputCostPer1M;
      stats.savedVsAllExpert += expertCost - actualCost;
    }

    return stats;
  }

  /**
   * Convenience method to get the default model for a tier.
   */
  getModel(tier: ModelTier): ModelSpec {
    return getDefaultModel(tier);
  }
}
