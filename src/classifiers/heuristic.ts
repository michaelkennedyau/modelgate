/**
 * ModelGate — Heuristic message classifier
 *
 * Free, sub-millisecond classification using pattern matching and scoring.
 * No API calls needed. Deterministic results.
 */

import type { ClassificationResult, ClassifyInput } from "../types.js";
import { getDefaultModel } from "../registry/models.js";

/** Default patterns that signal simple/fast-tier messages */
const DEFAULT_SIMPLE_PATTERNS: RegExp[] = [
  /^(what|where|when|who|which)\s+(is|are|was|were)\b/i,
  /^(how)\s+(do|does|did|can|could|would|should|is|are|much|many|long|far|old|tall)\b/i,
  /^(is|are|was|were|do|does|did|can|could|will|would|should|has|have|had)\s+/i,
  /^(define|translate|convert|format|list|name|spell|count)\b/i,
  /\b(yes or no)\b/i,
  /\b(true or false)\b/i,
];

/** Default patterns that signal complex/quality+ messages */
const DEFAULT_COMPLEX_PATTERNS: RegExp[] = [
  /\b(plan|planning)\b/i,
  /\b(compare|comparing|comparison)\b/i,
  /\b(analy[sz]e|analysis|analyzing)\b/i,
  /\b(optimi[sz]e|optimization|optimizing)\b/i,
  /\b(evaluate|evaluation|evaluating)\b/i,
  /\b(strateg(y|ize|ic|ies))\b/i,
  /\b(synthe[sz]i[sz]e|synthesis)\b/i,
  /\b(architect(ure)?|design pattern)\b/i,
  /\b(trade-?off|pros?\s+and\s+cons?)\b/i,
  /\b(refactor|debug|review)\b/i,
];

/** Patterns for greeting/acknowledgment messages — always fast tier */
const GREETING_PATTERNS: RegExp[] = [
  /^(hi|hello|hey|howdy|greetings|yo|sup|hiya|morning|evening|afternoon)\b/i,
  /^(thanks|thank you|thx|ty|cheers|ta|appreciated)\b/i,
  /^(ok|okay|sure|got it|understood|right|noted|perfect|great|cool|nice|awesome)\b[.!]?$/i,
  /^(yes|no|yep|nope|yup|nah|yeah|nay)\b[.!]?$/i,
  /^(bye|goodbye|see ya|later|ciao|farewell)\b/i,
];

/** Patterns for back-references to conversation context */
const BACK_REFERENCE_PATTERNS: RegExp[] = [
  /\b(that one|the one|this one)\b/i,
  /\b(earlier|previously|before|above|last time)\b/i,
  /\b(change it|update it|modify it|fix it|redo it|try again)\b/i,
  /\b(what you said|you mentioned|you suggested)\b/i,
  /\b(same thing|like before|as before)\b/i,
];

export interface HeuristicConfig {
  /** Score threshold: below = fast, at or above = quality/expert. Default: 0.4 */
  threshold?: number;
  /** Additional simple patterns to merge with defaults */
  simplePatterns?: RegExp[];
  /** Additional complex patterns to merge with defaults */
  complexPatterns?: RegExp[];
}

/**
 * Classify a message using heuristic scoring.
 *
 * Scoring algorithm:
 * - Start at base 0.5
 * - Short messages: -0.2, Long messages: +0.15
 * - Greeting/ack patterns: early return fast
 * - Simple query patterns: -0.2
 * - Complex patterns: +0.2 each, capped at +0.4
 * - Multiple questions (2+): +0.1
 * - Structured content (numbered lists): +0.15
 * - Back-references to conversation: +0.1
 * - Clamp to [0, 1]
 */
export function classifyHeuristic(
  input: ClassifyInput,
  config?: HeuristicConfig,
): ClassificationResult {
  const message = input.message;
  const threshold = config?.threshold ?? 0.4;
  const reasons: string[] = [];

  const simplePatterns = [...DEFAULT_SIMPLE_PATTERNS, ...(config?.simplePatterns ?? [])];
  const complexPatterns = [...DEFAULT_COMPLEX_PATTERNS, ...(config?.complexPatterns ?? [])];

  // ── Greeting/acknowledgment fast-path ──────────────────────────────────
  for (const pattern of GREETING_PATTERNS) {
    if (pattern.test(message.trim())) {
      const model = getDefaultModel("fast");
      reasons.push("Message is a greeting or acknowledgment");
      return {
        tier: "fast",
        modelId: model.id,
        score: 0.0,
        reasons,
        classifierUsed: false,
      };
    }
  }

  // ── Base score ─────────────────────────────────────────────────────────
  let score = 0.5;

  // ── Message length ─────────────────────────────────────────────────────
  const wordCount = message.split(/\s+/).filter(Boolean).length;
  if (wordCount <= 8) {
    score -= 0.2;
    reasons.push(`Short message (${wordCount} words): -0.2`);
  } else if (wordCount >= 50) {
    score += 0.15;
    reasons.push(`Long message (${wordCount} words): +0.15`);
  }

  // ── Simple query patterns ──────────────────────────────────────────────
  let matchedSimple = false;
  for (const pattern of simplePatterns) {
    if (pattern.test(message)) {
      matchedSimple = true;
      break;
    }
  }
  if (matchedSimple) {
    score -= 0.2;
    reasons.push("Matches simple query pattern: -0.2");
  }

  // ── Complex patterns ───────────────────────────────────────────────────
  let complexBonus = 0;
  const matchedComplexNames: string[] = [];
  for (const pattern of complexPatterns) {
    if (pattern.test(message)) {
      const matched = message.match(pattern);
      matchedComplexNames.push(matched?.[0] ?? "pattern");
      complexBonus += 0.2;
      if (complexBonus >= 0.4) break;
    }
  }
  if (complexBonus > 0) {
    score += complexBonus;
    reasons.push(
      `Complex patterns matched [${matchedComplexNames.join(", ")}]: +${complexBonus.toFixed(1)}`,
    );
  }

  // ── Question count ─────────────────────────────────────────────────────
  const questionMarks = (message.match(/\?/g) || []).length;
  if (questionMarks >= 2) {
    score += 0.1;
    reasons.push(`Multiple questions (${questionMarks}): +0.1`);
  }

  // ── Structured content (numbered lists) ────────────────────────────────
  const numberedListMatches = message.match(/^\s*\d+[.)]\s/gm);
  if (numberedListMatches && numberedListMatches.length >= 2) {
    score += 0.15;
    reasons.push(`Structured content (${numberedListMatches.length} numbered items): +0.15`);
  }

  // ── Back-references ────────────────────────────────────────────────────
  let hasBackReference = false;
  for (const pattern of BACK_REFERENCE_PATTERNS) {
    if (pattern.test(message)) {
      hasBackReference = true;
      break;
    }
  }
  if (hasBackReference) {
    score += 0.1;
    reasons.push("Contains back-reference to conversation: +0.1");
  }

  // ── Clamp score ────────────────────────────────────────────────────────
  score = Math.max(0, Math.min(1, score));

  // ── Determine tier ─────────────────────────────────────────────────────
  let tier: "fast" | "quality" | "expert";
  if (score < threshold) {
    tier = "fast";
  } else if (score >= 0.75) {
    tier = "expert";
  } else {
    tier = "quality";
  }

  const model = getDefaultModel(tier);
  reasons.push(`Final score: ${score.toFixed(2)} → tier: ${tier}`);

  return {
    tier,
    modelId: model.id,
    score,
    reasons,
    classifierUsed: false,
  };
}
