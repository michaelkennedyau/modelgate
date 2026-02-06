import { describe, expect, test } from "bun:test";
import {
  MODEL_REGISTRY,
  getDefaultModel,
  getModelsByProvider,
  getModelsByTier,
  registerModel,
} from "../src/registry/models.js";
import type { ModelSpec } from "../src/types.js";

describe("Model Registry", () => {
  // ── Built-in models have valid pricing ─────────────────────────────────
  describe("built-in model validation", () => {
    test("all models have positive input cost", () => {
      for (const [id, model] of Object.entries(MODEL_REGISTRY)) {
        expect(model.inputCostPer1M).toBeGreaterThan(0);
      }
    });

    test("all models have positive output cost", () => {
      for (const [id, model] of Object.entries(MODEL_REGISTRY)) {
        expect(model.outputCostPer1M).toBeGreaterThan(0);
      }
    });

    test("all models have positive maxTokens", () => {
      for (const [id, model] of Object.entries(MODEL_REGISTRY)) {
        expect(model.maxTokens).toBeGreaterThan(0);
      }
    });

    test("all models have valid tier", () => {
      for (const model of Object.values(MODEL_REGISTRY)) {
        expect(["fast", "quality", "expert"]).toContain(model.tier);
      }
    });

    test("all models have valid provider", () => {
      for (const model of Object.values(MODEL_REGISTRY)) {
        expect(["anthropic", "openai", "google", "custom"]).toContain(model.provider);
      }
    });

    test("model ID matches registry key", () => {
      for (const [key, model] of Object.entries(MODEL_REGISTRY)) {
        expect(model.id).toBe(key);
      }
    });

    test("output cost >= input cost for all models", () => {
      for (const model of Object.values(MODEL_REGISTRY)) {
        expect(model.outputCostPer1M).toBeGreaterThanOrEqual(model.inputCostPer1M);
      }
    });
  });

  // ── getModelsByTier ────────────────────────────────────────────────────
  describe("getModelsByTier()", () => {
    test("returns fast-tier models", () => {
      const fastModels = getModelsByTier("fast");
      expect(fastModels.length).toBeGreaterThanOrEqual(3);
      for (const m of fastModels) {
        expect(m.tier).toBe("fast");
      }
    });

    test("returns quality-tier models", () => {
      const qualityModels = getModelsByTier("quality");
      expect(qualityModels.length).toBeGreaterThanOrEqual(2);
      for (const m of qualityModels) {
        expect(m.tier).toBe("quality");
      }
    });

    test("returns expert-tier models", () => {
      const expertModels = getModelsByTier("expert");
      expect(expertModels.length).toBeGreaterThanOrEqual(2);
      for (const m of expertModels) {
        expect(m.tier).toBe("expert");
      }
    });
  });

  // ── getModelsByProvider ────────────────────────────────────────────────
  describe("getModelsByProvider()", () => {
    test("returns Anthropic models", () => {
      const models = getModelsByProvider("anthropic");
      expect(models.length).toBe(3);
      for (const m of models) {
        expect(m.provider).toBe("anthropic");
      }
    });

    test("returns OpenAI models", () => {
      const models = getModelsByProvider("openai");
      expect(models.length).toBe(3);
      for (const m of models) {
        expect(m.provider).toBe("openai");
      }
    });

    test("returns Google models", () => {
      const models = getModelsByProvider("google");
      expect(models.length).toBe(2);
      for (const m of models) {
        expect(m.provider).toBe("google");
      }
    });
  });

  // ── getDefaultModel ────────────────────────────────────────────────────
  describe("getDefaultModel()", () => {
    test("returns Anthropic by default for fast", () => {
      const model = getDefaultModel("fast");
      expect(model.provider).toBe("anthropic");
      expect(model.tier).toBe("fast");
    });

    test("returns Anthropic by default for quality", () => {
      const model = getDefaultModel("quality");
      expect(model.provider).toBe("anthropic");
      expect(model.tier).toBe("quality");
    });

    test("returns Anthropic by default for expert", () => {
      const model = getDefaultModel("expert");
      expect(model.provider).toBe("anthropic");
      expect(model.tier).toBe("expert");
    });

    test("returns specified provider when given", () => {
      const model = getDefaultModel("fast", "openai");
      expect(model.provider).toBe("openai");
      expect(model.tier).toBe("fast");
      expect(model.id).toBe("gpt-4o-mini");
    });

    test("returns Google model when requested", () => {
      const model = getDefaultModel("fast", "google");
      expect(model.provider).toBe("google");
      expect(model.id).toBe("gemini-2.5-flash");
    });

    test("falls back to default preference if provider has no tier match", () => {
      // Google has no expert tier model in built-ins
      // This should fall back to anthropic
      const model = getDefaultModel("expert", "google");
      expect(model.provider).toBe("anthropic");
    });
  });

  // ── registerModel ──────────────────────────────────────────────────────
  describe("registerModel()", () => {
    test("adds custom model to registry", () => {
      const customModel: ModelSpec = {
        id: "test-custom-model",
        name: "Test Custom Model",
        tier: "fast",
        provider: "custom",
        inputCostPer1M: 0.05,
        outputCostPer1M: 0.1,
        maxTokens: 16_000,
      };

      registerModel(customModel);
      expect(MODEL_REGISTRY["test-custom-model"]).toBeDefined();
      expect(MODEL_REGISTRY["test-custom-model"].name).toBe("Test Custom Model");
    });

    test("overwrites existing model with same ID", () => {
      const updated: ModelSpec = {
        id: "test-custom-model",
        name: "Updated Custom Model",
        tier: "quality",
        provider: "custom",
        inputCostPer1M: 0.1,
        outputCostPer1M: 0.2,
        maxTokens: 32_000,
      };

      registerModel(updated);
      expect(MODEL_REGISTRY["test-custom-model"].name).toBe("Updated Custom Model");
      expect(MODEL_REGISTRY["test-custom-model"].tier).toBe("quality");
    });

    test("registered model appears in tier queries", () => {
      const model: ModelSpec = {
        id: "test-tier-query-model",
        name: "Tier Query Test",
        tier: "expert",
        provider: "custom",
        inputCostPer1M: 1,
        outputCostPer1M: 5,
        maxTokens: 64_000,
      };

      registerModel(model);
      const expertModels = getModelsByTier("expert");
      const found = expertModels.find((m) => m.id === "test-tier-query-model");
      expect(found).toBeDefined();
    });
  });
});
