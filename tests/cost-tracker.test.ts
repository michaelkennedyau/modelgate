import { describe, expect, test, beforeEach } from "bun:test";
import { CostTracker } from "../src/tracker/cost.js";
import type { UsageRecord } from "../src/types.js";

describe("CostTracker", () => {
  let tracker: CostTracker;

  beforeEach(() => {
    tracker = new CostTracker();
  });

  // Helper to create a usage record
  function makeRecord(
    overrides: Partial<UsageRecord> = {},
  ): UsageRecord {
    return {
      taskType: "chat",
      modelId: "claude-haiku-4-5-20251001",
      tier: "fast",
      inputTokens: 1000,
      outputTokens: 500,
      timestamp: Date.now(),
      ...overrides,
    };
  }

  test("recordUsage increments totalCalls", () => {
    expect(tracker.totalCalls).toBe(0);
    tracker.recordUsage(makeRecord());
    expect(tracker.totalCalls).toBe(1);
    tracker.recordUsage(makeRecord());
    expect(tracker.totalCalls).toBe(2);
  });

  test("cost calculation is accurate for Haiku", () => {
    // Haiku: $1/1M input, $5/1M output
    // 1000 input tokens = 1000/1_000_000 * 1 = 0.001
    // 500 output tokens = 500/1_000_000 * 5 = 0.0025
    // Total: 0.0035
    tracker.recordUsage(
      makeRecord({
        modelId: "claude-haiku-4-5-20251001",
        inputTokens: 1000,
        outputTokens: 500,
      }),
    );

    const expected = 0.001 + 0.0025;
    expect(tracker.totalCost).toBeCloseTo(expected, 10);
  });

  test("cost calculation is accurate for Sonnet", () => {
    // Sonnet: $3/1M input, $15/1M output
    // 2000 input = 2000/1_000_000 * 3 = 0.006
    // 1000 output = 1000/1_000_000 * 15 = 0.015
    // Total: 0.021
    tracker.recordUsage(
      makeRecord({
        modelId: "claude-sonnet-4-5-20250929",
        tier: "quality",
        inputTokens: 2000,
        outputTokens: 1000,
      }),
    );

    expect(tracker.totalCost).toBeCloseTo(0.021, 10);
  });

  test("cost calculation is accurate for Opus", () => {
    // Opus: $5/1M input, $25/1M output
    // 5000 input = 5000/1_000_000 * 5 = 0.025
    // 2000 output = 2000/1_000_000 * 25 = 0.05
    // Total: 0.075
    tracker.recordUsage(
      makeRecord({
        modelId: "claude-opus-4-6",
        tier: "expert",
        inputTokens: 5000,
        outputTokens: 2000,
      }),
    );

    expect(tracker.totalCost).toBeCloseTo(0.075, 10);
  });

  test("unknown model returns 0 cost", () => {
    tracker.recordUsage(
      makeRecord({
        modelId: "unknown-model-xyz",
        inputTokens: 1000,
        outputTokens: 500,
      }),
    );

    expect(tracker.totalCost).toBe(0);
    expect(tracker.totalCalls).toBe(1);
  });

  test("byTier aggregation works", () => {
    tracker.recordUsage(
      makeRecord({ tier: "fast", modelId: "claude-haiku-4-5-20251001" }),
    );
    tracker.recordUsage(
      makeRecord({ tier: "fast", modelId: "claude-haiku-4-5-20251001" }),
    );
    tracker.recordUsage(
      makeRecord({
        tier: "quality",
        modelId: "claude-sonnet-4-5-20250929",
        inputTokens: 2000,
        outputTokens: 1000,
      }),
    );
    tracker.recordUsage(
      makeRecord({
        tier: "expert",
        modelId: "claude-opus-4-6",
        inputTokens: 5000,
        outputTokens: 2000,
      }),
    );

    const stats = tracker.getStats();
    expect(stats.byTier.fast.calls).toBe(2);
    expect(stats.byTier.quality.calls).toBe(1);
    expect(stats.byTier.expert.calls).toBe(1);

    // Verify cost aggregation for fast tier
    // 2 calls * (1000/1M * 1 + 500/1M * 5) = 2 * 0.0035 = 0.007
    expect(stats.byTier.fast.cost).toBeCloseTo(0.007, 10);
  });

  test("byTaskType aggregation works", () => {
    tracker.recordUsage(makeRecord({ taskType: "chat" }));
    tracker.recordUsage(makeRecord({ taskType: "chat" }));
    tracker.recordUsage(makeRecord({ taskType: "code_generation" }));

    const stats = tracker.getStats();
    expect(stats.byTaskType.chat.calls).toBe(2);
    expect(stats.byTaskType.code_generation.calls).toBe(1);
  });

  test("savedVsAllQuality calculates correctly", () => {
    // Record a "fast" call that would be cheaper than quality
    // Haiku: 1000 input, 500 output
    // Actual cost (Haiku): 1000/1M*1 + 500/1M*5 = 0.001 + 0.0025 = 0.0035
    // Quality cost (Sonnet): 1000/1M*3 + 500/1M*15 = 0.003 + 0.0075 = 0.0105
    // Savings: 0.0105 - 0.0035 = 0.007
    tracker.recordUsage(
      makeRecord({
        tier: "fast",
        modelId: "claude-haiku-4-5-20251001",
        inputTokens: 1000,
        outputTokens: 500,
      }),
    );

    const stats = tracker.getStats();
    expect(stats.savedVsAllQuality).toBeCloseTo(0.007, 10);
  });

  test("savedVsAllExpert calculates correctly", () => {
    // Record a "fast" call
    // Actual cost (Haiku): 0.0035
    // Expert cost (Opus): 1000/1M*5 + 500/1M*25 = 0.005 + 0.0125 = 0.0175
    // Savings: 0.0175 - 0.0035 = 0.014
    tracker.recordUsage(
      makeRecord({
        tier: "fast",
        modelId: "claude-haiku-4-5-20251001",
        inputTokens: 1000,
        outputTokens: 500,
      }),
    );

    const stats = tracker.getStats();
    expect(stats.savedVsAllExpert).toBeCloseTo(0.014, 10);
  });

  test("savings are 0 when already using the comparison tier", () => {
    // If all calls use quality tier, savedVsAllQuality should be 0
    tracker.recordUsage(
      makeRecord({
        tier: "quality",
        modelId: "claude-sonnet-4-5-20250929",
        inputTokens: 1000,
        outputTokens: 500,
      }),
    );

    const stats = tracker.getStats();
    expect(stats.savedVsAllQuality).toBeCloseTo(0, 10);
  });

  test("reset() clears everything", () => {
    tracker.recordUsage(makeRecord());
    tracker.recordUsage(makeRecord());
    expect(tracker.totalCalls).toBe(2);
    expect(tracker.totalCost).toBeGreaterThan(0);

    tracker.reset();
    expect(tracker.totalCalls).toBe(0);
    expect(tracker.totalCost).toBe(0);

    const stats = tracker.getStats();
    expect(stats.totalCalls).toBe(0);
    expect(stats.totalCost).toBe(0);
    expect(stats.byTier.fast.calls).toBe(0);
    expect(stats.byTier.quality.calls).toBe(0);
    expect(stats.byTier.expert.calls).toBe(0);
    expect(stats.savedVsAllQuality).toBe(0);
    expect(stats.savedVsAllExpert).toBe(0);
  });

  test("getStats totalCost matches totalCost getter", () => {
    tracker.recordUsage(makeRecord());
    tracker.recordUsage(
      makeRecord({
        modelId: "claude-sonnet-4-5-20250929",
        tier: "quality",
        inputTokens: 2000,
        outputTokens: 1000,
      }),
    );

    const stats = tracker.getStats();
    expect(stats.totalCost).toBeCloseTo(tracker.totalCost, 10);
    expect(stats.totalCalls).toBe(tracker.totalCalls);
  });
});
