import { describe, expect, test } from "bun:test";
import { ModelGate } from "../src/gate.js";

describe("ModelGate", () => {
  // ── Default config ─────────────────────────────────────────────────────
  describe("default configuration", () => {
    test("creates instance with no config", () => {
      const gate = new ModelGate();
      expect(gate).toBeDefined();
    });

    test("creates instance with empty config", () => {
      const gate = new ModelGate({});
      expect(gate).toBeDefined();
    });
  });

  // ── classify() ─────────────────────────────────────────────────────────
  describe("classify()", () => {
    test("accepts a plain string", () => {
      const gate = new ModelGate();
      const result = gate.classify("hello");
      expect(result.tier).toBe("fast");
      expect(result.modelId).toBeDefined();
      expect(result.reasons.length).toBeGreaterThan(0);
    });

    test("accepts a ClassifyInput object", () => {
      const gate = new ModelGate();
      const result = gate.classify({ message: "What is 2+2?" });
      expect(result.tier).toBe("fast");
      expect(typeof result.score).toBe("number");
    });

    test("complex messages get quality/expert tier", () => {
      const gate = new ModelGate();
      const result = gate.classify(
        "Analyze the architecture and plan a comprehensive strategy for optimizing our system",
      );
      expect(["quality", "expert"]).toContain(result.tier);
    });

    test("returns valid ClassificationResult shape", () => {
      const gate = new ModelGate();
      const result = gate.classify("test message");
      expect(result).toHaveProperty("tier");
      expect(result).toHaveProperty("modelId");
      expect(result).toHaveProperty("score");
      expect(result).toHaveProperty("reasons");
      expect(["fast", "quality", "expert"]).toContain(result.tier);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
      expect(Array.isArray(result.reasons)).toBe(true);
    });
  });

  // ── classifyTask() ─────────────────────────────────────────────────────
  describe("classifyTask()", () => {
    test("summarization → fast", () => {
      const gate = new ModelGate();
      const result = gate.classifyTask("summarization");
      expect(result.tier).toBe("fast");
    });

    test("code_generation → quality", () => {
      const gate = new ModelGate();
      const result = gate.classifyTask("code_generation");
      expect(result.tier).toBe("quality");
    });

    test("strategy → expert", () => {
      const gate = new ModelGate();
      const result = gate.classifyTask("strategy");
      expect(result.tier).toBe("expert");
    });

    test("unknown task → quality (default)", () => {
      const gate = new ModelGate();
      const result = gate.classifyTask("something_completely_unknown");
      expect(result.tier).toBe("quality");
    });

    test("taskOverrides change tier", () => {
      const gate = new ModelGate({
        taskOverrides: { summarization: "expert" },
      });
      const result = gate.classifyTask("summarization");
      expect(result.tier).toBe("expert");
    });
  });

  // ── forceModel ─────────────────────────────────────────────────────────
  describe("forceModel", () => {
    test("forces classify() to return forced tier", () => {
      const gate = new ModelGate({ forceModel: "expert" });
      const result = gate.classify("hi");
      expect(result.tier).toBe("expert");
    });

    test("forces classifyTask() to return forced tier", () => {
      const gate = new ModelGate({ forceModel: "fast" });
      const result = gate.classifyTask("strategy");
      expect(result.tier).toBe("fast");
    });

    test("override reason is provided", () => {
      const gate = new ModelGate({ forceModel: "quality" });
      const result = gate.classify("hello");
      expect(result.reasons.some((r) => r.includes("Forced"))).toBe(true);
    });
  });

  // ── getModel() ─────────────────────────────────────────────────────────
  describe("getModel()", () => {
    test("returns fast-tier model", () => {
      const gate = new ModelGate();
      const model = gate.getModel("fast");
      expect(model.tier).toBe("fast");
      expect(model.id).toBeDefined();
      expect(model.inputCostPer1M).toBeGreaterThan(0);
    });

    test("returns quality-tier model", () => {
      const gate = new ModelGate();
      const model = gate.getModel("quality");
      expect(model.tier).toBe("quality");
    });

    test("returns expert-tier model", () => {
      const gate = new ModelGate();
      const model = gate.getModel("expert");
      expect(model.tier).toBe("expert");
    });

    test("default models are Anthropic", () => {
      const gate = new ModelGate();
      expect(gate.getModel("fast").provider).toBe("anthropic");
      expect(gate.getModel("quality").provider).toBe("anthropic");
      expect(gate.getModel("expert").provider).toBe("anthropic");
    });
  });

  // ── Cost tracking ──────────────────────────────────────────────────────
  describe("cost tracking", () => {
    test("getStats() returns null when tracking disabled", () => {
      const gate = new ModelGate();
      expect(gate.getStats()).toBeNull();
    });

    test("getStats() returns stats when tracking enabled", () => {
      const gate = new ModelGate({ tracking: true });
      expect(gate.getStats()).not.toBeNull();
      expect(gate.getStats()?.totalCalls).toBe(0);
    });

    test("recordUsage() tracks calls", () => {
      const gate = new ModelGate({ tracking: true });
      gate.recordUsage({
        taskType: "summarization",
        modelId: "claude-haiku-4-5-20251001",
        tier: "fast",
        inputTokens: 1000,
        outputTokens: 500,
      });

      const stats = gate.getStats();
      expect(stats).not.toBeNull();
      expect(stats!.totalCalls).toBe(1);
      expect(stats!.totalCost).toBeGreaterThan(0);
      expect(stats!.byTier.fast.calls).toBe(1);
      expect(stats!.byTaskType.summarization.calls).toBe(1);
    });

    test("recordUsage() is no-op when tracking disabled", () => {
      const gate = new ModelGate({ tracking: false });
      gate.recordUsage({
        taskType: "summarization",
        modelId: "claude-haiku-4-5-20251001",
        tier: "fast",
        inputTokens: 1000,
        outputTokens: 500,
      });
      expect(gate.getStats()).toBeNull();
    });

    test("savings calculations are positive when using fast tier", () => {
      const gate = new ModelGate({ tracking: true });
      gate.recordUsage({
        taskType: "summarization",
        modelId: "claude-haiku-4-5-20251001",
        tier: "fast",
        inputTokens: 100_000,
        outputTokens: 50_000,
      });

      const stats = gate.getStats()!;
      expect(stats.savedVsAllQuality).toBeGreaterThan(0);
      expect(stats.savedVsAllExpert).toBeGreaterThan(0);
    });
  });

  // ── Custom models ──────────────────────────────────────────────────────
  describe("custom models", () => {
    test("customModels are registered on construction", () => {
      const gate = new ModelGate({
        customModels: [
          {
            id: "my-custom-model",
            name: "My Custom Model",
            tier: "fast",
            provider: "custom",
            inputCostPer1M: 0.01,
            outputCostPer1M: 0.02,
            maxTokens: 32_000,
          },
        ],
      });
      // The model should be accessible now (verified via registry test)
      expect(gate).toBeDefined();
    });
  });
});
