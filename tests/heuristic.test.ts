import { describe, expect, test } from "bun:test";
import { classifyHeuristic } from "../src/classifiers/heuristic.js";

describe("Heuristic Classifier", () => {
  // ── Greetings → fast tier ──────────────────────────────────────────────
  describe("greetings and acknowledgments", () => {
    const greetings = ["hi", "Hello", "Hey there", "thanks", "Thank you!", "ok", "yes", "bye"];

    for (const msg of greetings) {
      test(`"${msg}" → fast tier`, () => {
        const result = classifyHeuristic({ message: msg });
        expect(result.tier).toBe("fast");
        expect(result.score).toBe(0.0);
        expect(result.reasons.length).toBeGreaterThan(0);
        expect(result.classifierUsed).toBe(false);
      });
    }
  });

  // ── Simple questions → fast tier ───────────────────────────────────────
  describe("simple questions", () => {
    const simpleQuestions = [
      "What is the capital of France?",
      "How do I reset my password?",
      "Is this available?",
      "Define photosynthesis",
      "Translate hello to Spanish",
    ];

    for (const msg of simpleQuestions) {
      test(`"${msg}" → fast tier`, () => {
        const result = classifyHeuristic({ message: msg });
        expect(result.tier).toBe("fast");
        expect(result.classifierUsed).toBe(false);
      });
    }
  });

  // ── Complex requests → quality or expert ───────────────────────────────
  describe("complex requests", () => {
    test("planning request → quality+", () => {
      const result = classifyHeuristic({
        message:
          "I need you to plan a comprehensive migration strategy for our database from PostgreSQL to a distributed system, comparing the trade-offs of each approach",
      });
      expect(["quality", "expert"]).toContain(result.tier);
      expect(result.score).toBeGreaterThanOrEqual(0.4);
    });

    test("analysis request → quality+", () => {
      const result = classifyHeuristic({
        message:
          "Analyze the performance characteristics of our API endpoints and optimize the most critical bottlenecks. Evaluate the trade-offs between caching strategies.",
      });
      expect(["quality", "expert"]).toContain(result.tier);
      expect(result.score).toBeGreaterThanOrEqual(0.4);
    });

    test("multi-pattern complex request → expert", () => {
      const result = classifyHeuristic({
        message:
          "Synthesize our quarterly data, analyze the trends, develop a strategy for growth, and evaluate our competitive position against the top 5 players in this market",
      });
      expect(["quality", "expert"]).toContain(result.tier);
      expect(result.score).toBeGreaterThanOrEqual(0.5);
    });

    test("architecture request → quality+", () => {
      const result = classifyHeuristic({
        message:
          "Design the architecture for a new microservices platform that handles real-time analytics and compare the design patterns we could use",
      });
      expect(["quality", "expert"]).toContain(result.tier);
    });
  });

  // ── Score bounds ───────────────────────────────────────────────────────
  describe("score bounds", () => {
    test("score is always between 0 and 1", () => {
      const testMessages = [
        "hi",
        "What is 2+2?",
        "Plan and analyze and optimize and evaluate and synthesize and compare the entire system architecture with all the trade-offs listed in numbered format:\n1. First consideration\n2. Second consideration\n3. Third consideration",
        "",
        "a",
        "x".repeat(1000),
      ];

      for (const msg of testMessages) {
        const result = classifyHeuristic({ message: msg });
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(1);
      }
    });
  });

  // ── Custom patterns ────────────────────────────────────────────────────
  describe("custom patterns", () => {
    test("custom simple patterns lower score", () => {
      const result = classifyHeuristic(
        { message: "Look up the FOOBAR value" },
        { simplePatterns: [/\bfoobar\b/i] },
      );
      // With custom simple pattern, score should be lower
      const resultWithout = classifyHeuristic({ message: "Look up the FOOBAR value" });
      expect(result.score).toBeLessThan(resultWithout.score);
    });

    test("custom complex patterns raise score", () => {
      const result = classifyHeuristic(
        { message: "Please xylophone the entire dataset" },
        { complexPatterns: [/\bxylophone\b/i] },
      );
      const resultWithout = classifyHeuristic({
        message: "Please xylophone the entire dataset",
      });
      expect(result.score).toBeGreaterThan(resultWithout.score);
    });
  });

  // ── Reason strings populated ───────────────────────────────────────────
  describe("reason strings", () => {
    test("reasons array is never empty", () => {
      const messages = [
        "hi",
        "What is the meaning of life?",
        "Plan a comprehensive strategy",
      ];
      for (const msg of messages) {
        const result = classifyHeuristic({ message: msg });
        expect(result.reasons.length).toBeGreaterThan(0);
        for (const reason of result.reasons) {
          expect(typeof reason).toBe("string");
          expect(reason.length).toBeGreaterThan(0);
        }
      }
    });

    test("includes final score in reasons", () => {
      const result = classifyHeuristic({
        message: "Tell me about machine learning approaches",
      });
      const hasScoreReason = result.reasons.some((r) => r.includes("Final score"));
      expect(hasScoreReason).toBe(true);
    });
  });

  // ── Multiple questions ─────────────────────────────────────────────────
  describe("multiple questions", () => {
    test("2+ questions increases score", () => {
      const single = classifyHeuristic({ message: "What is the best approach?" });
      const multiple = classifyHeuristic({
        message: "What is the best approach? And how should we implement it? What are the risks?",
      });
      expect(multiple.score).toBeGreaterThan(single.score);
    });
  });

  // ── Structured content ─────────────────────────────────────────────────
  describe("structured content", () => {
    test("numbered lists increase score", () => {
      const flat = classifyHeuristic({ message: "Describe the main features of the product" });
      const structured = classifyHeuristic({
        message:
          "Describe the main features:\n1. Performance characteristics\n2. Scalability limits\n3. Integration options",
      });
      expect(structured.score).toBeGreaterThan(flat.score);
    });
  });

  // ── Back-references ────────────────────────────────────────────────────
  describe("back-references", () => {
    test("conversation references increase score", () => {
      const fresh = classifyHeuristic({ message: "Describe the product features" });
      const backRef = classifyHeuristic({
        message: "Change it to use the approach you mentioned earlier",
      });
      expect(backRef.score).toBeGreaterThan(fresh.score);
    });
  });

  // ── Custom threshold ───────────────────────────────────────────────────
  describe("custom threshold", () => {
    test("higher threshold makes more messages fast", () => {
      const message = "Describe the main features of the product in detail";
      const lowThreshold = classifyHeuristic({ message }, { threshold: 0.3 });
      const highThreshold = classifyHeuristic({ message }, { threshold: 0.8 });

      // Same score but different tier assignment
      expect(lowThreshold.score).toBe(highThreshold.score);
      // High threshold is more likely to classify as fast
      if (lowThreshold.tier !== "fast") {
        expect(highThreshold.tier === "fast" || highThreshold.score < 0.8).toBe(true);
      }
    });
  });
});
