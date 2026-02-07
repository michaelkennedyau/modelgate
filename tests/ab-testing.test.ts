import { describe, expect, test } from "bun:test";
import { ExperimentManager, selectVariant } from "../src/ab/experiment.js";
import type { Experiment, ExperimentVariant } from "../src/types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create a valid two-variant 50/50 experiment */
function makeFiftyFifty(name = "fifty-fifty", active = true): Experiment {
  return {
    name,
    active,
    variants: [
      { name: "control", tier: "quality", weight: 0.5 },
      { name: "cheaper", tier: "fast", weight: 0.5 },
    ],
  };
}

/** Create a valid 90/10 experiment */
function makeNinetyTen(name = "ninety-ten"): Experiment {
  return {
    name,
    active: true,
    variants: [
      { name: "dominant", tier: "quality", weight: 0.9 },
      { name: "minority", tier: "fast", weight: 0.1 },
    ],
  };
}

/** Create a three-variant experiment */
function makeThreeWay(name = "three-way"): Experiment {
  return {
    name,
    active: true,
    variants: [
      { name: "fast-variant", tier: "fast", weight: 0.5 },
      { name: "quality-variant", tier: "quality", weight: 0.3 },
      { name: "expert-variant", tier: "expert", weight: 0.2 },
    ],
  };
}

// ============================================================================
// EXPERIMENT MANAGEMENT
// ============================================================================

describe("ExperimentManager — Experiment Management", () => {
  test("addExperiment registers an experiment", () => {
    const mgr = new ExperimentManager();
    mgr.addExperiment(makeFiftyFifty());
    expect(mgr.getExperiment("fifty-fifty")).toBeDefined();
  });

  test("getExperiment returns undefined for unknown name", () => {
    const mgr = new ExperimentManager();
    expect(mgr.getExperiment("nonexistent")).toBeUndefined();
  });

  test("removeExperiment removes a registered experiment", () => {
    const mgr = new ExperimentManager();
    mgr.addExperiment(makeFiftyFifty());
    mgr.removeExperiment("fifty-fifty");
    expect(mgr.getExperiment("fifty-fifty")).toBeUndefined();
  });

  test("removeExperiment is a no-op for unknown name", () => {
    const mgr = new ExperimentManager();
    // Should not throw
    mgr.removeExperiment("nonexistent");
    expect(mgr.listExperiments()).toHaveLength(0);
  });

  test("listExperiments returns all experiments", () => {
    const mgr = new ExperimentManager();
    mgr.addExperiment(makeFiftyFifty("exp-a"));
    mgr.addExperiment(makeNinetyTen("exp-b"));
    mgr.addExperiment(makeThreeWay("exp-c"));
    const list = mgr.listExperiments();
    expect(list).toHaveLength(3);
    const names = list.map((e) => e.name);
    expect(names).toContain("exp-a");
    expect(names).toContain("exp-b");
    expect(names).toContain("exp-c");
  });

  test("addExperiment overwrites experiment with same name", () => {
    const mgr = new ExperimentManager();
    mgr.addExperiment(makeFiftyFifty("dup"));
    mgr.addExperiment(makeNinetyTen("dup"));
    const exp = mgr.getExperiment("dup");
    expect(exp).toBeDefined();
    // The ninety-ten has "dominant" and "minority" variants
    expect(exp?.variants[0].name).toBe("dominant");
    expect(mgr.listExperiments()).toHaveLength(1);
  });

  test("setActive activates a deactivated experiment", () => {
    const mgr = new ExperimentManager();
    mgr.addExperiment(makeFiftyFifty("toggle", false));
    expect(mgr.getExperiment("toggle")?.active).toBe(false);
    mgr.setActive("toggle", true);
    expect(mgr.getExperiment("toggle")?.active).toBe(true);
  });

  test("setActive deactivates an active experiment", () => {
    const mgr = new ExperimentManager();
    mgr.addExperiment(makeFiftyFifty("toggle", true));
    mgr.setActive("toggle", false);
    expect(mgr.getExperiment("toggle")?.active).toBe(false);
  });

  test("setActive throws for unknown experiment", () => {
    const mgr = new ExperimentManager();
    expect(() => mgr.setActive("ghost", true)).toThrow('Experiment "ghost" not found');
  });
});

// ============================================================================
// VARIANT SELECTION (selectVariant)
// ============================================================================

describe("selectVariant — Weighted Random Selection", () => {
  test("single variant is always selected", () => {
    const variant: ExperimentVariant = { name: "only", tier: "fast", weight: 1.0 };
    for (let i = 0; i < 100; i++) {
      expect(selectVariant([variant])).toBe(variant);
    }
  });

  test("throws on empty variants array", () => {
    expect(() => selectVariant([])).toThrow("Cannot select from empty variants array");
  });

  test("two equal-weight variants approach 50/50 over many iterations", () => {
    const variants: ExperimentVariant[] = [
      { name: "a", tier: "fast", weight: 0.5 },
      { name: "b", tier: "quality", weight: 0.5 },
    ];

    const counts: Record<string, number> = { a: 0, b: 0 };
    const iterations = 5000;

    for (let i = 0; i < iterations; i++) {
      const selected = selectVariant(variants);
      counts[selected.name]++;
    }

    const percentA = counts.a / iterations;
    const percentB = counts.b / iterations;
    // Each should be between 40% and 60%
    expect(percentA).toBeGreaterThan(0.4);
    expect(percentA).toBeLessThan(0.6);
    expect(percentB).toBeGreaterThan(0.4);
    expect(percentB).toBeLessThan(0.6);
  });

  test("heavily weighted variant dominates (90/10 split)", () => {
    const variants: ExperimentVariant[] = [
      { name: "heavy", tier: "quality", weight: 0.9 },
      { name: "light", tier: "fast", weight: 0.1 },
    ];

    const counts: Record<string, number> = { heavy: 0, light: 0 };
    const iterations = 5000;

    for (let i = 0; i < iterations; i++) {
      const selected = selectVariant(variants);
      counts[selected.name]++;
    }

    const percentHeavy = counts.heavy / iterations;
    // Heavy should be 80-100% range
    expect(percentHeavy).toBeGreaterThan(0.8);
    expect(percentHeavy).toBeLessThan(1.0);
  });

  test("three variants distribute correctly", () => {
    const variants: ExperimentVariant[] = [
      { name: "a", tier: "fast", weight: 0.5 },
      { name: "b", tier: "quality", weight: 0.3 },
      { name: "c", tier: "expert", weight: 0.2 },
    ];

    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    const iterations = 10000;

    for (let i = 0; i < iterations; i++) {
      const selected = selectVariant(variants);
      counts[selected.name]++;
    }

    const pA = counts.a / iterations;
    const pB = counts.b / iterations;
    const pC = counts.c / iterations;

    // Allow generous tolerance for randomness
    expect(pA).toBeGreaterThan(0.4);
    expect(pA).toBeLessThan(0.6);
    expect(pB).toBeGreaterThan(0.2);
    expect(pB).toBeLessThan(0.4);
    expect(pC).toBeGreaterThan(0.12);
    expect(pC).toBeLessThan(0.28);
  });
});

// ============================================================================
// ASSIGNMENT
// ============================================================================

describe("ExperimentManager — Assignment", () => {
  test("returns undefined for unknown experiment", () => {
    const mgr = new ExperimentManager();
    expect(mgr.assign("nonexistent")).toBeUndefined();
  });

  test("returns undefined for inactive experiment", () => {
    const mgr = new ExperimentManager();
    mgr.addExperiment(makeFiftyFifty("inactive-exp", false));
    expect(mgr.assign("inactive-exp")).toBeUndefined();
  });

  test("returns a valid assignment for active experiment", () => {
    const mgr = new ExperimentManager();
    mgr.addExperiment(makeFiftyFifty());
    const assignment = mgr.assign("fifty-fifty");
    expect(assignment).toBeDefined();
    expect(assignment?.experimentName).toBe("fifty-fifty");
    expect(["control", "cheaper"]).toContain(assignment?.variantName);
    expect(["quality", "fast"]).toContain(assignment?.tier);
    expect(assignment?.modelId).toBeDefined();
    expect(assignment?.modelId.length).toBeGreaterThan(0);
  });

  test("assignment includes correct modelId from registry", () => {
    const mgr = new ExperimentManager();
    mgr.addExperiment({
      name: "fast-only",
      active: true,
      variants: [{ name: "fast-v", tier: "fast", weight: 1.0 }],
    });

    const assignment = mgr.assign("fast-only");
    expect(assignment).toBeDefined();
    // Default fast-tier model for Anthropic is claude-haiku-4-5-20251001
    expect(assignment?.modelId).toBe("claude-haiku-4-5-20251001");
    expect(assignment?.tier).toBe("fast");
  });

  test("assignment for quality tier returns correct model", () => {
    const mgr = new ExperimentManager();
    mgr.addExperiment({
      name: "quality-only",
      active: true,
      variants: [{ name: "quality-v", tier: "quality", weight: 1.0 }],
    });

    const assignment = mgr.assign("quality-only");
    expect(assignment).toBeDefined();
    expect(assignment?.modelId).toBe("claude-sonnet-4-5-20250929");
    expect(assignment?.tier).toBe("quality");
  });

  test("assignment for expert tier returns correct model", () => {
    const mgr = new ExperimentManager();
    mgr.addExperiment({
      name: "expert-only",
      active: true,
      variants: [{ name: "expert-v", tier: "expert", weight: 1.0 }],
    });

    const assignment = mgr.assign("expert-only");
    expect(assignment).toBeDefined();
    expect(assignment?.modelId).toBe("claude-opus-4-6");
    expect(assignment?.tier).toBe("expert");
  });

  test("assignments are recorded correctly", () => {
    const mgr = new ExperimentManager();
    mgr.addExperiment(makeFiftyFifty());
    mgr.assign("fifty-fifty");
    mgr.assign("fifty-fifty");
    mgr.assign("fifty-fifty");
    const all = mgr.getAssignments("fifty-fifty");
    expect(all).toHaveLength(3);
    for (const a of all) {
      expect(a.experimentName).toBe("fifty-fifty");
    }
  });

  test("assignments from different experiments are separated", () => {
    const mgr = new ExperimentManager();
    mgr.addExperiment(makeFiftyFifty("exp-1"));
    mgr.addExperiment(makeNinetyTen("exp-2"));

    mgr.assign("exp-1");
    mgr.assign("exp-1");
    mgr.assign("exp-2");

    expect(mgr.getAssignments("exp-1")).toHaveLength(2);
    expect(mgr.getAssignments("exp-2")).toHaveLength(1);
    // All assignments
    expect(mgr.getAssignments()).toHaveLength(3);
  });

  test("deactivating an experiment stops new assignments", () => {
    const mgr = new ExperimentManager();
    mgr.addExperiment(makeFiftyFifty("toggle"));
    expect(mgr.assign("toggle")).toBeDefined();
    mgr.setActive("toggle", false);
    expect(mgr.assign("toggle")).toBeUndefined();
    // Only the first assignment was recorded
    expect(mgr.getAssignments("toggle")).toHaveLength(1);
  });
});

// ============================================================================
// DISTRIBUTION STATS
// ============================================================================

describe("ExperimentManager — Distribution Stats", () => {
  test("returns undefined for unknown experiment", () => {
    const mgr = new ExperimentManager();
    expect(mgr.getDistribution("nonexistent")).toBeUndefined();
  });

  test("returns empty distribution for experiment with no assignments", () => {
    const mgr = new ExperimentManager();
    mgr.addExperiment(makeFiftyFifty());
    const dist = mgr.getDistribution("fifty-fifty");
    expect(dist).toBeDefined();
    expect(dist?.control.count).toBe(0);
    expect(dist?.control.percentage).toBe(0);
    expect(dist?.cheaper.count).toBe(0);
    expect(dist?.cheaper.percentage).toBe(0);
  });

  test("returns correct percentages after many assignments", () => {
    const mgr = new ExperimentManager();
    mgr.addExperiment(makeFiftyFifty());

    for (let i = 0; i < 2000; i++) {
      mgr.assign("fifty-fifty");
    }

    const dist = mgr.getDistribution("fifty-fifty");
    expect(dist).toBeDefined();
    if (!dist) return;
    expect(dist.control.count + dist.cheaper.count).toBe(2000);
    // Each should be roughly 50%
    expect(dist.control.percentage).toBeGreaterThan(0.4);
    expect(dist.control.percentage).toBeLessThan(0.6);
    expect(dist.cheaper.percentage).toBeGreaterThan(0.4);
    expect(dist.cheaper.percentage).toBeLessThan(0.6);
    // Percentages sum to 1.0
    expect(dist.control.percentage + dist.cheaper.percentage).toBeCloseTo(1.0);
  });

  test("distribution reflects 90/10 weighting", () => {
    const mgr = new ExperimentManager();
    mgr.addExperiment(makeNinetyTen());

    for (let i = 0; i < 3000; i++) {
      mgr.assign("ninety-ten");
    }

    const dist = mgr.getDistribution("ninety-ten");
    expect(dist).toBeDefined();
    if (!dist) return;
    expect(dist.dominant.percentage).toBeGreaterThan(0.8);
    expect(dist.minority.percentage).toBeLessThan(0.2);
  });

  test("clearAssignments resets all recorded assignments", () => {
    const mgr = new ExperimentManager();
    mgr.addExperiment(makeFiftyFifty());
    mgr.assign("fifty-fifty");
    mgr.assign("fifty-fifty");
    expect(mgr.getAssignments()).toHaveLength(2);
    mgr.clearAssignments();
    expect(mgr.getAssignments()).toHaveLength(0);
    const dist = mgr.getDistribution("fifty-fifty");
    expect(dist).toBeDefined();
    if (!dist) return;
    expect(dist.control.count).toBe(0);
    expect(dist.cheaper.count).toBe(0);
  });
});

// ============================================================================
// VALIDATION
// ============================================================================

describe("ExperimentManager.validate — Static Validation", () => {
  test("valid experiment passes", () => {
    const result = ExperimentManager.validate(makeFiftyFifty());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("valid three-variant experiment passes", () => {
    const result = ExperimentManager.validate(makeThreeWay());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("single variant with weight 1.0 is valid", () => {
    const result = ExperimentManager.validate({
      name: "solo",
      active: true,
      variants: [{ name: "only", tier: "fast", weight: 1.0 }],
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("empty variants array fails", () => {
    const result = ExperimentManager.validate({
      name: "empty",
      active: true,
      variants: [],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("at least 1 variant");
  });

  test("zero weight fails", () => {
    const result = ExperimentManager.validate({
      name: "zero-weight",
      active: true,
      variants: [
        { name: "a", tier: "fast", weight: 0 },
        { name: "b", tier: "quality", weight: 1.0 },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("weight"))).toBe(true);
  });

  test("negative weight fails", () => {
    const result = ExperimentManager.validate({
      name: "neg-weight",
      active: true,
      variants: [
        { name: "a", tier: "fast", weight: -0.5 },
        { name: "b", tier: "quality", weight: 1.5 },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("weight"))).toBe(true);
  });

  test("weights not summing to 1.0 fails (too high)", () => {
    const result = ExperimentManager.validate({
      name: "over-weight",
      active: true,
      variants: [
        { name: "a", tier: "fast", weight: 0.7 },
        { name: "b", tier: "quality", weight: 0.7 },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("sum"))).toBe(true);
  });

  test("weights not summing to 1.0 fails (too low)", () => {
    const result = ExperimentManager.validate({
      name: "under-weight",
      active: true,
      variants: [
        { name: "a", tier: "fast", weight: 0.3 },
        { name: "b", tier: "quality", weight: 0.3 },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("sum"))).toBe(true);
  });

  test("weights within 0.01 tolerance pass", () => {
    const result = ExperimentManager.validate({
      name: "close-enough",
      active: true,
      variants: [
        { name: "a", tier: "fast", weight: 0.504 },
        { name: "b", tier: "quality", weight: 0.504 },
      ],
    });
    // Sum is 1.008 — within tolerance, should pass
    expect(result.valid).toBe(true);
  });

  test("weights just outside tolerance fail", () => {
    const result = ExperimentManager.validate({
      name: "too-far",
      active: true,
      variants: [
        { name: "a", tier: "fast", weight: 0.51 },
        { name: "b", tier: "quality", weight: 0.51 },
      ],
    });
    // Sum is 1.02 — just beyond tolerance
    expect(result.valid).toBe(false);
  });

  test("duplicate variant names fails", () => {
    const result = ExperimentManager.validate({
      name: "dup-names",
      active: true,
      variants: [
        { name: "same", tier: "fast", weight: 0.5 },
        { name: "same", tier: "quality", weight: 0.5 },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Duplicate"))).toBe(true);
  });

  test("invalid tier value fails", () => {
    const result = ExperimentManager.validate({
      name: "bad-tier",
      active: true,
      variants: [
        // Force an invalid tier via type assertion
        { name: "a", tier: "superfast" as "fast", weight: 1.0 },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("invalid tier"))).toBe(true);
  });

  test("multiple errors are all reported", () => {
    const result = ExperimentManager.validate({
      name: "multi-error",
      active: true,
      variants: [
        { name: "a", tier: "fast", weight: 0 },
        { name: "a", tier: "bogus" as "fast", weight: 0.5 },
      ],
    });
    expect(result.valid).toBe(false);
    // Should report: zero weight, weight sum wrong, duplicate name, invalid tier
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});
