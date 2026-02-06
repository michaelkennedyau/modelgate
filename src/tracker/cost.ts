/**
 * ModelGate — Cost tracker
 *
 * Records API usage and calculates costs by looking up model pricing
 * in the MODEL_REGISTRY. Provides aggregations by tier, task type,
 * and savings estimates vs. all-quality or all-expert routing.
 */

import type { CostStats, ModelTier, UsageRecord } from "../types.js";
import { MODEL_REGISTRY, getDefaultModel } from "../registry/models.js";

export class CostTracker {
  private records: UsageRecord[] = [];

  /**
   * Record a single API call's token usage.
   */
  recordUsage(record: UsageRecord): void {
    this.records.push(record);
  }

  /**
   * Get full aggregated cost statistics.
   */
  getStats(): CostStats {
    const byTier: Record<ModelTier, { calls: number; cost: number }> = {
      fast: { calls: 0, cost: 0 },
      quality: { calls: 0, cost: 0 },
      expert: { calls: 0, cost: 0 },
    };

    const byTaskType: Record<string, { calls: number; cost: number }> = {};

    let totalCost = 0;
    let qualityCost = 0;
    let expertCost = 0;

    const qualityModel = getDefaultModel("quality");
    const expertModel = getDefaultModel("expert");

    for (const record of this.records) {
      const cost = this.calculateCost(record);
      totalCost += cost;

      // Aggregate by tier
      byTier[record.tier].calls += 1;
      byTier[record.tier].cost += cost;

      // Aggregate by task type
      if (!byTaskType[record.taskType]) {
        byTaskType[record.taskType] = { calls: 0, cost: 0 };
      }
      byTaskType[record.taskType].calls += 1;
      byTaskType[record.taskType].cost += cost;

      // Calculate hypothetical costs for savings comparison
      qualityCost +=
        (record.inputTokens / 1_000_000) * qualityModel.inputCostPer1M +
        (record.outputTokens / 1_000_000) * qualityModel.outputCostPer1M;

      expertCost +=
        (record.inputTokens / 1_000_000) * expertModel.inputCostPer1M +
        (record.outputTokens / 1_000_000) * expertModel.outputCostPer1M;
    }

    return {
      totalCalls: this.records.length,
      totalCost,
      byTier,
      byTaskType,
      savedVsAllQuality: qualityCost - totalCost,
      savedVsAllExpert: expertCost - totalCost,
    };
  }

  /**
   * Clear all recorded usage data.
   */
  reset(): void {
    this.records = [];
  }

  /**
   * Total cost across all recorded usage (USD).
   */
  get totalCost(): number {
    let total = 0;
    for (const record of this.records) {
      total += this.calculateCost(record);
    }
    return total;
  }

  /**
   * Total number of recorded API calls.
   */
  get totalCalls(): number {
    return this.records.length;
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /**
   * Calculate the cost of a single usage record by looking up the model
   * in the registry. Returns 0 if the model is not found.
   */
  private calculateCost(record: UsageRecord): number {
    const model = MODEL_REGISTRY[record.modelId];
    if (!model) {
      return 0;
    }
    return (
      (record.inputTokens / 1_000_000) * model.inputCostPer1M +
      (record.outputTokens / 1_000_000) * model.outputCostPer1M
    );
  }
}
