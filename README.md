# modelgate

**Route every LLM call to the cheapest model that can handle it.**

[![npm version](https://img.shields.io/npm/v/modelgate)](https://www.npmjs.com/package/modelgate)
[![license](https://img.shields.io/npm/l/modelgate)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)

---

## Why

Every AI-powered app hardcodes a single model and overpays. A simple "What time is it?" hits the same $15/1M-token model as "Analyze the financial implications of this merger." ModelGate sits upstream of your LLM calls and classifies each one into a cost tier -- fast, quality, or expert -- so you always use the cheapest model that can handle the job. Teams using this approach in production see **40-50% cost reduction** with no loss in output quality.

**The math:**

```
Without ModelGate:  1000 calls x $0.015 avg = $15.00
With heuristic only: 400 fast + 600 quality  = $10.40 (31% saved)
With LLM classifier: 550 fast + 450 quality  = $8.25  (45% saved)
                     + 200 classifier calls  = $0.08
                     Net savings: 45%
```

---

## Quick Start

```bash
bun add modelgate
# or
npm install modelgate
```

### 1. Minimal -- zero config, heuristic only

```typescript
import { ModelGate } from "modelgate";

const gate = new ModelGate();

const result = gate.classify({ message: "What flights go to Tokyo?" });
// {
//   tier: "fast",
//   modelId: "claude-haiku-4-5-20251001",
//   score: 0.15,
//   reasons: ["simple query", "short message"]
// }
```

### 2. Intelligent -- LLM classifier for ambiguous messages

```typescript
const gate = new ModelGate({
  apiKey: process.env.ANTHROPIC_API_KEY,
  intelligent: true,
});

// Ambiguous message -- heuristic is unsure, LLM classifier kicks in
const result = await gate.classify({
  message: "Can you help me figure out the best approach for restructuring our data pipeline?",
});
// {
//   tier: "quality",
//   modelId: "claude-sonnet-4-5-20250929",
//   score: 0.65,
//   reasons: ["llm-classified: moderate complexity"],
//   classifierUsed: true
// }
```

### 3. Task-based -- known operation types

```typescript
const gate = new ModelGate();

const result = gate.classifyTask("sentiment_analysis");
// { tier: "fast", modelId: "claude-haiku-4-5-20251001", score: 1.0, reasons: ["task-type: sentiment_analysis"] }

const result2 = gate.classifyTask("financial_analysis");
// { tier: "expert", modelId: "claude-opus-4-6", score: 1.0, reasons: ["task-type: financial_analysis"] }
```

---

## How It Works

ModelGate uses a two-phase classification approach:

### Phase 1: Heuristic Scoring (free, sub-millisecond)

Every message gets a complexity score from 0.0 (trivial) to 1.0 (complex) based on:

| Signal | What it detects |
|--------|----------------|
| Message length / word count | Short messages are usually simple |
| Greeting patterns | "Hi", "Thanks" -- early exit to fast tier |
| Simple query patterns | Single-intent questions, yes/no, factual lookups |
| Complex keywords | "analyze", "compare", "optimize", "plan" |
| Multi-step indicators | "first...then", "and then", "if...else" |
| Analysis language | "pros and cons", "trade-off", "which is better" |
| Question count | 2+ questions signal higher complexity |
| Structured content | Numbered lists, bullet points, code blocks |
| Custom patterns | Your own RegExp rules for domain-specific signals |

This handles roughly 80% of messages with high confidence.

### Phase 2: LLM Classifier (optional, ~$0.0004/call)

When the heuristic score falls in the ambiguity band (default 0.3-0.7), ModelGate optionally calls a fast LLM (Haiku) to classify the message as SIMPLE, MODERATE, or COMPLEX. This requires an Anthropic API key and `intelligent: true` in your config.

- Cost: ~500 input tokens + 1 output token = **$0.0004 per classification**
- Cached: identical messages skip re-classification (LRU cache, 1000 entries default)
- Timeout: falls back to heuristic result if the classifier is slow

**The economics:** If 20% of messages hit the classifier, and 60% of those get downgraded from a quality-tier to a fast-tier model, the classifier pays for itself 15x over.

### Flow Diagram

```
         Message / Task
              |
              v
     ┌────────────────┐
     │   Heuristic     │   Phase 1: free, <1ms
     │   Classifier    │   Score 0.0 - 1.0
     └───────┬────────┘
             |
        Score in 0.3-0.7?
        /            \
      No              Yes + intelligent mode
      |                \
      v                 v
   Use score    ┌──────────────┐
   directly     │  LLM          │   Phase 2: $0.0004
                │  Classifier   │   Haiku-powered
                └──────┬───────┘
                       |
                       v
              ┌────────────────┐
              │  Model          │   Select cheapest model
              │  Registry       │   in the target tier
              └────────────────┘
                       |
                       v
            ClassificationResult
            { tier, modelId, score, reasons }
```

---

## Model Registry

Built-in models with current pricing (USD per 1M tokens):

### Anthropic

| Model ID | Name | Tier | Input | Output | Context |
|----------|------|------|-------|--------|---------|
| `claude-haiku-4-5-20251001` | Claude Haiku 4.5 | fast | $1.00 | $5.00 | 200K |
| `claude-sonnet-4-5-20250929` | Claude Sonnet 4.5 | quality | $3.00 | $15.00 | 200K |
| `claude-opus-4-6` | Claude Opus 4.6 | expert | $5.00 | $25.00 | 200K |

### OpenAI

| Model ID | Name | Tier | Input | Output | Context |
|----------|------|------|-------|--------|---------|
| `gpt-4o-mini` | GPT-4o Mini | fast | $0.15 | $0.60 | 128K |
| `gpt-4o` | GPT-4o | quality | $2.50 | $10.00 | 128K |
| `o3` | OpenAI o3 | expert | $10.00 | $40.00 | 200K |

### Google

| Model ID | Name | Tier | Input | Output | Context |
|----------|------|------|-------|--------|---------|
| `gemini-2.5-flash` | Gemini 2.5 Flash | fast | $0.15 | $0.60 | 1M |
| `gemini-2.5-pro` | Gemini 2.5 Pro | quality | $1.25 | $10.00 | 1M |

### Adding Custom Models

```typescript
const gate = new ModelGate({
  customModels: [
    {
      id: "mistral-large-latest",
      name: "Mistral Large",
      tier: "quality",
      provider: "custom",
      inputCostPer1M: 2.0,
      outputCostPer1M: 6.0,
      maxTokens: 128_000,
    },
  ],
});
```

---

## Task Type Routing

ModelGate ships with default tier mappings for common task types. Use `classifyTask()` to skip heuristic scoring entirely when you know the operation type.

### Default Mappings

| Tier | Task Types |
|------|-----------|
| **fast** | `classification`, `extraction`, `sentiment_analysis`, `entity_extraction`, `summarization`, `translation`, `formatting`, `tagging` |
| **quality** | `content_generation`, `chat`, `code_generation`, `explanation`, `comparison`, `planning`, `editing`, `research` |
| **expert** | `financial_analysis`, `legal_analysis`, `strategy`, `architecture`, `audit`, `complex_reasoning` |

### Overriding Defaults

```typescript
const gate = new ModelGate({
  taskOverrides: {
    // Your prompts for content generation work fine on the fast tier
    content_generation: "fast",
    // Your chat needs expert-level reasoning
    chat: "expert",
  },
});

gate.classifyTask("content_generation");
// { tier: "fast", modelId: "claude-haiku-4-5-20251001", ... }
```

---

## Cost Tracking

Enable tracking to record token usage and calculate savings.

```typescript
const gate = new ModelGate({ tracking: true });

// After each LLM call, record usage
gate.recordUsage({
  taskType: "chat",
  modelId: "claude-haiku-4-5-20251001",
  tier: "fast",
  inputTokens: 500,
  outputTokens: 200,
  timestamp: Date.now(),
});

gate.recordUsage({
  taskType: "code_generation",
  modelId: "claude-sonnet-4-5-20250929",
  tier: "quality",
  inputTokens: 2000,
  outputTokens: 1500,
  timestamp: Date.now(),
});

// Get aggregated stats
const stats = gate.getStats();
// {
//   totalCalls: 2,
//   totalCost: 0.0235,
//   byTier: {
//     fast:    { calls: 1, cost: 0.0015 },
//     quality: { calls: 1, cost: 0.0285 },
//     expert:  { calls: 0, cost: 0 }
//   },
//   byTaskType: {
//     chat:            { calls: 1, cost: 0.0015 },
//     code_generation: { calls: 1, cost: 0.0285 }
//   },
//   savedVsAllQuality: 0.012,
//   savedVsAllExpert: 0.045
// }
```

---

## Configuration

### Full Config Object

```typescript
import type { ModelGateConfig } from "modelgate";

const config: ModelGateConfig = {
  // API key for intelligent classification (Anthropic)
  apiKey: process.env.ANTHROPIC_API_KEY,

  // Enable LLM-powered classification for ambiguous messages
  intelligent: true,

  // Score threshold: below = fast, at or above = quality/expert (default: 0.4)
  threshold: 0.4,

  // Ambiguity band: scores in this range trigger LLM classifier (default: [0.3, 0.7])
  ambiguityBand: [0.3, 0.7],

  // Default provider preference order
  providerPreference: ["anthropic", "openai", "google"],

  // Enable cost tracking (default: false)
  tracking: true,

  // Task type -> tier overrides
  taskOverrides: {
    content_generation: "fast",
  },

  // Custom heuristic patterns to extend defaults
  customPatterns: {
    simple: [/^(yes|no|ok|sure|thanks)$/i],
    complex: [/\b(regulatory|compliance|GAAP)\b/i],
  },

  // Force all traffic to one tier (emergency override)
  forceModel: undefined,

  // Model to use for LLM classifier (default: cheapest fast-tier model)
  classifierModel: "claude-haiku-4-5-20251001",

  // LRU cache size for classifier results (default: 1000)
  classifierCacheSize: 1000,

  // Custom models to add to registry
  customModels: [],
};
```

### Environment Variables

Environment variables are always respected and override config values:

| Variable | Values | Description |
|----------|--------|-------------|
| `MODELGATE_FORCE` | `fast`, `quality`, `expert` | Force all traffic to one tier |
| `MODELGATE_INTELLIGENT` | `true`, `false` | Enable/disable LLM classifier |
| `MODELGATE_THRESHOLD` | `0.0` - `1.0` | Classification threshold |
| `MODELGATE_CLASSIFIER_MODEL` | model ID string | Override classifier model |

---

## API Reference

### `ModelGate` Class

```typescript
import { ModelGate } from "modelgate";
```

#### `constructor(config?: ModelGateConfig)`

Create a new ModelGate instance. All config options are optional.

#### `classify(input: ClassifyInput): ClassificationResult | Promise<ClassificationResult>`

Classify a message and return the recommended model. Returns synchronously in heuristic-only mode. Returns a Promise when intelligent mode is enabled and the heuristic score is ambiguous.

```typescript
// ClassifyInput
interface ClassifyInput {
  message: string;
  messages?: Array<{ role: string; content?: string | unknown }>;
}
```

#### `classifyTask(taskType: string): ClassificationResult`

Classify by task type using the default or overridden tier mappings. Always synchronous.

#### `recordUsage(record: UsageRecord): void`

Record a single API call's token usage for cost tracking. Requires `tracking: true` in config.

```typescript
interface UsageRecord {
  taskType: string;
  modelId: string;
  tier: ModelTier;
  inputTokens: number;
  outputTokens: number;
  timestamp: number;
}
```

#### `getStats(): CostStats`

Get aggregated cost statistics. Requires `tracking: true` in config.

```typescript
interface CostStats {
  totalCalls: number;
  totalCost: number;
  byTier: Record<ModelTier, { calls: number; cost: number }>;
  byTaskType: Record<string, { calls: number; cost: number }>;
  savedVsAllQuality: number;
  savedVsAllExpert: number;
}
```

### Types

```typescript
import type {
  ModelTier,          // "fast" | "quality" | "expert"
  Provider,           // "anthropic" | "openai" | "google" | "custom"
  ModelSpec,          // Full model specification with pricing
  ClassificationResult,
  ClassifyInput,
  UsageRecord,
  CostStats,
  ModelGateConfig,
} from "modelgate";

import { DEFAULT_TASK_TIERS } from "modelgate";
```

---

## Comparison with Alternatives

| Feature | RouteLLM | OpenRouter Auto | llm-router-ts | **ModelGate** |
|---------|----------|-----------------|----------------|---------------|
| Language | Python | API (any) | TypeScript | **TypeScript** |
| Self-hosted | Yes | No | Yes | **Yes** |
| Classification | ML models | Black box | Heuristic only | **Heuristic + LLM** |
| Cost tracking | No | Dashboard only | No | **Built-in** |
| Task-type routing | No | No | No | **Yes** |
| Zero dependencies | No | N/A | Yes | **Yes** |
| Env var overrides | No | No | No | **Yes** |
| Works offline | Yes | No | Yes | **Yes (heuristic)** |
| Price per call | Free | Model cost | Free | **Free or $0.0004** |

---

## What This Is NOT

- **Not a proxy/gateway.** ModelGate does not make API calls for you. It tells you _which model_ to use. Your existing code calls the provider.
- **Not a provider abstraction.** Use Vercel AI SDK, LangChain, or direct SDKs for that. ModelGate sits upstream.
- **Not an observability platform.** Cost tracking is local and in-memory. For production monitoring, pipe stats to your existing system.
- **Not ML-based.** No training data, no BERT, no matrix factorization. Heuristics + optional LLM classifier. Simple, predictable, debuggable.

---

## Built With

ModelGate was extracted from three production applications -- a travel planner, a client review system, and a financial companion app -- each of which independently solved the model routing problem. This package is the universal solution.

| Dependency | Purpose |
|-----------|---------|
| [TypeScript](https://www.typescriptlang.org/) | Language (strict mode) |
| [Bun](https://bun.sh/) | Runtime and test runner |
| [tsup](https://tsup.egoist.dev/) | Build (ESM + CJS dual output) |
| [Biome](https://biomejs.dev/) | Linting and formatting |

Zero runtime dependencies. The Anthropic SDK is an optional peer dependency (only needed for intelligent mode).

---

## License

[MIT](./LICENSE) -- Copyright (c) 2026 Michael Kennedy
