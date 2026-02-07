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

## What's New in v0.2

- **Middleware Pipeline** -- composable, Express-style hooks around every LLM call
- **Provider Adapters** -- call Anthropic, OpenAI, and Google directly through ModelGate
- **Streaming** -- `gate.stream()` with automatic model selection
- **A/B Testing** -- run experiments to measure cost vs quality tradeoffs
- **5 Built-in Middlewares** -- logging, retry, timeout, caching, cost recording

---

## Quick Start

```bash
npm install modelgate
```

### 1. Classify only (zero config)

```typescript
import { ModelGate } from "modelgate";

const gate = new ModelGate();

const result = gate.classify({ message: "What flights go to Tokyo?" });
// { tier: "fast", modelId: "claude-haiku-4-5-20251001", score: 0.15, reasons: [...] }
```

### 2. Full SDK -- classify + call + middleware

```typescript
import { ModelGate, loggingMiddleware, retryMiddleware } from "modelgate";

const gate = new ModelGate({
  providers: {
    anthropic: { apiKey: process.env.ANTHROPIC_API_KEY },
  },
  tracking: true,
});

gate.use(loggingMiddleware());
gate.use(retryMiddleware({ maxRetries: 2 }));

const response = await gate.chat(
  [{ role: "user", content: "What's the capital of France?" }],
  { systemPrompt: "You are a helpful assistant." },
);
// Automatically classifies → picks Haiku → calls Anthropic → returns response
// response.content = "The capital of France is Paris."
// response.tier = "fast"
// response.usage = { inputTokens: 25, outputTokens: 12 }
```

### 3. Streaming

```typescript
const chunks = gate.stream(
  [{ role: "user", content: "Explain quantum computing in simple terms" }],
);

for await (const chunk of chunks) {
  if (chunk.type === "text") process.stdout.write(chunk.text);
}
```

### 4. Task-based routing

```typescript
gate.classifyTask("sentiment_analysis");  // → fast (Haiku)
gate.classifyTask("code_generation");     // → quality (Sonnet)
gate.classifyTask("financial_analysis");  // → expert (Opus)
```

---

## How It Works

### Two-Phase Classification

```
         Message
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
```

#### Phase 1: Heuristic Scoring (free, sub-millisecond)

| Signal | What it detects |
|--------|----------------|
| Message length / word count | Short messages are usually simple |
| Greeting patterns | "Hi", "Thanks" -- early exit to fast tier |
| Simple query patterns | Single-intent questions, yes/no, factual lookups |
| Complex keywords | "analyze", "compare", "optimize", "plan" |
| Multi-step indicators | "first...then", "and then", "if...else" |
| Question count | 2+ questions signal higher complexity |
| Structured content | Numbered lists, bullet points, code blocks |
| Custom patterns | Your own RegExp rules for domain-specific signals |

Handles ~80% of messages with high confidence.

#### Phase 2: LLM Classifier (optional, ~$0.0004/call)

When the heuristic score falls in the ambiguity band (default 0.3-0.7), ModelGate optionally calls Haiku to classify the message. Requires `apiKey` and `intelligent: true`.

- **Cached:** LRU cache (1000 entries default) -- identical messages skip re-classification
- **Timeout:** Falls back to heuristic result if the classifier is slow

---

## Middleware Pipeline

ModelGate v0.2 includes a composable middleware system that wraps `chat()` calls. Middlewares run in registration order using the onion model (like Koa/Express).

```typescript
import {
  ModelGate,
  loggingMiddleware,
  retryMiddleware,
  timeoutMiddleware,
  cachingMiddleware,
  costRecorderMiddleware,
} from "modelgate";

const gate = new ModelGate({
  providers: { anthropic: { apiKey: process.env.ANTHROPIC_API_KEY } },
  tracking: true,
});

// Middlewares run in order: logging → retry → timeout → caching → cost
gate.use(loggingMiddleware());
gate.use(retryMiddleware({ maxRetries: 2, backoffMs: 100 }));
gate.use(timeoutMiddleware(30_000));
gate.use(cachingMiddleware({ maxSize: 500, ttlMs: 300_000 }));
gate.use(costRecorderMiddleware(gate));
```

### Built-in Middlewares

| Middleware | Purpose | Defaults |
|-----------|---------|----------|
| `loggingMiddleware(logger?)` | Log request tier/model and response latency | `console.log` |
| `retryMiddleware(options?)` | Retry on error with exponential backoff | 2 retries, 100ms |
| `timeoutMiddleware(ms?)` | Abort if response takes too long | 30,000ms |
| `cachingMiddleware(options?)` | LRU cache keyed on message content | 500 entries, 5min TTL |
| `costRecorderMiddleware(tracker)` | Record token usage after each response | -- |

### Custom Middleware

```typescript
import type { Middleware } from "modelgate";

const myMiddleware: Middleware = async (ctx, next) => {
  // Before: modify request context
  ctx.metadata.startTime = Date.now();

  // Call next middleware (or the LLM if last in chain)
  const response = await next();

  // After: modify or inspect response
  console.log(`Took ${Date.now() - (ctx.metadata.startTime as number)}ms`);
  return response;
};

gate.use(myMiddleware);
```

---

## Provider Adapters

Call LLMs directly through ModelGate. Providers use `fetch()` internally -- zero SDK dependencies.

### Setup

```typescript
const gate = new ModelGate({
  providers: {
    anthropic: { apiKey: process.env.ANTHROPIC_API_KEY },
    openai: { apiKey: process.env.OPENAI_API_KEY },
    google: { apiKey: process.env.GOOGLE_API_KEY },
  },
});
```

### `gate.chat()` -- Complete Response

Classifies the message, picks the right model, calls the provider, returns a unified response.

```typescript
const response = await gate.chat(
  [
    { role: "user", content: "What is 2 + 2?" },
  ],
  {
    systemPrompt: "Answer concisely.",
    maxTokens: 100,
    temperature: 0,
    taskType: "chat",
  },
);

// response.content   → "4"
// response.modelId   → "claude-haiku-4-5-20251001"
// response.tier      → "fast"
// response.usage     → { inputTokens: 18, outputTokens: 3 }
// response.latencyMs → 245
```

### `gate.stream()` -- Streaming Response

```typescript
const stream = gate.stream(
  [{ role: "user", content: "Write a haiku about TypeScript" }],
  { maxTokens: 100 },
);

for await (const chunk of stream) {
  switch (chunk.type) {
    case "text":
      process.stdout.write(chunk.text);
      break;
    case "usage":
      console.log("Tokens:", chunk.usage);
      break;
    case "done":
      console.log("Stream complete");
      break;
  }
}
```

### Using Adapters Directly

```typescript
import { AnthropicAdapter, OpenAIAdapter, GoogleAdapter } from "modelgate";

const anthropic = new AnthropicAdapter({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const response = await anthropic.chat({
  model: "claude-haiku-4-5-20251001",
  messages: [{ role: "user", content: "Hello" }],
  maxTokens: 100,
});
```

### Supported Providers

| Provider | Chat | Streaming | Auth |
|----------|------|-----------|------|
| **Anthropic** | Messages API | SSE streaming | `x-api-key` header |
| **OpenAI** | Chat Completions | SSE streaming | `Bearer` token |
| **Google** | Gemini `generateContent` | SSE streaming | `?key=` query param |

---

## A/B Testing

Run experiments to measure the impact of routing traffic to cheaper models.

```typescript
const gate = new ModelGate({
  experiments: [
    {
      name: "cost-savings-test",
      active: true,
      variants: [
        { name: "control", tier: "quality", weight: 0.5 },
        { name: "cheaper", tier: "fast", weight: 0.5 },
      ],
    },
  ],
});

// Assign a request to a variant
const assignment = gate.experiments.assign("cost-savings-test");
// { experimentName: "cost-savings-test", variantName: "cheaper", tier: "fast", modelId: "claude-haiku-..." }

// After many requests, check the distribution
const dist = gate.experiments.getDistribution("cost-savings-test");
// { control: { count: 487, percentage: 48.7 }, cheaper: { count: 513, percentage: 51.3 } }
```

### Managing Experiments

```typescript
// Add a new experiment at runtime
gate.experiments.addExperiment({
  name: "three-way-split",
  active: true,
  variants: [
    { name: "haiku", tier: "fast", weight: 0.6 },
    { name: "sonnet", tier: "quality", weight: 0.3 },
    { name: "opus", tier: "expert", weight: 0.1 },
  ],
});

// Pause an experiment
gate.experiments.setActive("cost-savings-test", false);

// Validate before adding
const { valid, errors } = ExperimentManager.validate(myExperiment);

// Review assignments
const assignments = gate.experiments.getAssignments("three-way-split");

// Clear recorded data
gate.experiments.clearAssignments();
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

Skip heuristic scoring when you know the operation type.

| Tier | Task Types |
|------|-----------|
| **fast** | `classification`, `extraction`, `sentiment_analysis`, `entity_extraction`, `summarization`, `translation`, `formatting`, `tagging` |
| **quality** | `content_generation`, `chat`, `code_generation`, `explanation`, `comparison`, `planning`, `editing`, `research` |
| **expert** | `financial_analysis`, `legal_analysis`, `strategy`, `architecture`, `audit`, `complex_reasoning` |

```typescript
const gate = new ModelGate({
  taskOverrides: {
    content_generation: "fast",  // downgrade
    chat: "expert",              // upgrade
  },
});
```

---

## Cost Tracking

```typescript
const gate = new ModelGate({ tracking: true });

// Automatic with chat() — usage is recorded automatically
const response = await gate.chat([{ role: "user", content: "Hello" }]);

// Manual recording
gate.recordUsage({
  taskType: "chat",
  modelId: "claude-haiku-4-5-20251001",
  tier: "fast",
  inputTokens: 500,
  outputTokens: 200,
  timestamp: Date.now(),
});

const stats = gate.getStats();
// {
//   totalCalls: 2,
//   totalCost: 0.0235,
//   byTier: { fast: { calls: 1, cost: 0.0015 }, quality: {...}, expert: {...} },
//   byTaskType: { chat: { calls: 2, cost: 0.0235 } },
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
  // Classification
  apiKey: process.env.ANTHROPIC_API_KEY,
  intelligent: true,
  threshold: 0.4,
  ambiguityBand: [0.3, 0.7],
  classifierModel: "claude-haiku-4-5-20251001",
  classifierCacheSize: 1000,

  // Providers (v0.2)
  providers: {
    anthropic: { apiKey: process.env.ANTHROPIC_API_KEY },
    openai: { apiKey: process.env.OPENAI_API_KEY },
    google: { apiKey: process.env.GOOGLE_API_KEY },
  },

  // Defaults for chat/stream (v0.2)
  defaultMaxTokens: 1024,
  defaultTemperature: undefined,  // use provider default

  // Routing
  providerPreference: ["anthropic", "openai", "google"],
  taskOverrides: { content_generation: "fast" },
  customPatterns: {
    simple: [/^(yes|no|ok|sure|thanks)$/i],
    complex: [/\b(regulatory|compliance|GAAP)\b/i],
  },
  forceModel: undefined,

  // Tracking
  tracking: true,

  // A/B Testing (v0.2)
  experiments: [
    {
      name: "cost-test",
      active: true,
      variants: [
        { name: "control", tier: "quality", weight: 0.5 },
        { name: "cheaper", tier: "fast", weight: 0.5 },
      ],
    },
  ],

  // Custom models
  customModels: [],
};
```

### Environment Variables

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
const gate = new ModelGate(config?);
```

| Method | Returns | Description |
|--------|---------|-------------|
| `classify(input)` | `ClassificationResult` | Classify a message by content |
| `classifyTask(taskType)` | `ClassificationResult` | Classify by known task type |
| `chat(messages, options?)` | `Promise<ResponseContext>` | Classify + call provider + return response |
| `stream(messages, options?)` | `AsyncIterable<StreamChunk>` | Classify + stream from provider |
| `use(middleware)` | `this` | Add middleware to the pipeline |
| `recordUsage(record)` | `void` | Record token usage (requires `tracking: true`) |
| `getStats()` | `CostStats \| null` | Get aggregated cost statistics |
| `getModel(tier)` | `ModelSpec` | Get the default model for a tier |
| `experiments` | `ExperimentManager` | Access the A/B experiment manager |

### Types

```typescript
import type {
  // Core
  ModelTier,              // "fast" | "quality" | "expert"
  Provider,               // "anthropic" | "openai" | "google" | "custom"
  ModelSpec,              // Model definition with pricing
  ClassificationResult,   // Classification output
  ClassifyInput,          // Classification input
  ModelGateConfig,        // Full configuration

  // Provider (v0.2)
  ChatRequest,            // Unified chat request
  ChatResponse,           // Unified chat response
  StreamChunk,            // Streaming chunk
  ProviderAdapter,        // Provider interface
  ProviderConfig,         // Provider setup

  // Middleware (v0.2)
  Middleware,              // Middleware function type
  RequestContext,          // Request flowing through pipeline
  ResponseContext,         // Response from LLM call

  // A/B Testing (v0.2)
  Experiment,             // Experiment definition
  ExperimentVariant,      // Variant with weight
  ExperimentAssignment,   // Assignment result

  // Tracking
  UsageRecord,            // Token usage record
  CostStats,              // Aggregated statistics
} from "modelgate";
```

---

## Comparison with Alternatives

| Feature | RouteLLM | OpenRouter Auto | llm-router-ts | **ModelGate** |
|---------|----------|-----------------|----------------|---------------|
| Language | Python | API (any) | TypeScript | **TypeScript** |
| Self-hosted | Yes | No | Yes | **Yes** |
| Classification | ML models | Black box | Heuristic only | **Heuristic + LLM** |
| Provider adapters | No | Yes | No | **Yes (v0.2)** |
| Streaming | No | Yes | No | **Yes (v0.2)** |
| Middleware | No | No | No | **Yes (v0.2)** |
| A/B testing | No | No | No | **Yes (v0.2)** |
| Cost tracking | No | Dashboard only | No | **Built-in** |
| Task-type routing | No | No | No | **Yes** |
| Zero dependencies | No | N/A | Yes | **Yes** |
| Works offline | Yes | No | Yes | **Yes (heuristic)** |

---

## Built With

| Dependency | Purpose |
|-----------|---------|
| [TypeScript](https://www.typescriptlang.org/) | Language (strict mode) |
| [Bun](https://bun.sh/) | Runtime and test runner |
| [tsup](https://tsup.egoist.dev/) | Build (ESM + CJS dual output) |
| [Biome](https://biomejs.dev/) | Linting and formatting |

Zero runtime dependencies. 241 tests. ESM + CJS dual output.

---

## License

[MIT](./LICENSE) -- Copyright (c) 2026 Michael Kennedy
