# ModelGate — Intelligent AI Model Router

> Route every LLM call to the cheapest model that can handle it.
> TypeScript-first. Self-hosted. Zero to intelligent in one API key.

## The Problem

Every AI app starts by hardcoding one model. As it grows, different operations need different models. Nobody builds the routing layer until costs spiral. We've solved this problem three times now:

| Project | Approach | Result |
|---------|----------|--------|
| Travel Planner | Heuristic message classifier | 40-50% cost reduction |
| Client Review System | Task-type enum + cost tracking | 40% reduction on 19 services |
| Coastal CFO Companion | Tiered config singleton | 40% on 8 API call sites |

Same problem. Three different solutions. Time to extract the universal one.

## The Landscape Gap

| Solution | Language | Self-hosted | Hybrid (Heuristic+LLM) | Cost Tracking | TS-native |
|----------|----------|-------------|------------------------|---------------|-----------|
| RouteLLM | Python | Yes | No (ML only) | No | No |
| LLMRouter | Python | Yes | No (ML only) | No | No |
| Martian | API | No | Proprietary | No | No |
| OpenRouter Auto | API | No | Black box | No | No |
| llm-router-ts | TypeScript | Yes | No (heuristic only) | No | Yes |
| **ModelGate** | **TypeScript** | **Yes** | **Yes** | **Yes** | **Yes** |

---

## Core Insight: Two-Phase Classification

**Phase 1: Heuristic (free, <1ms)**
Pattern matching, keyword detection, message structure analysis. Handles ~80% of messages with high confidence.

**Phase 2: LLM Classifier (optional, ~$0.0004/call)**
When the heuristic score is ambiguous (0.3-0.7), use Haiku to classify. 500 input tokens + 20 output tokens = $0.0004. Saves $0.01-0.10 per correctly downgraded call.

**The math:** If 20% of messages hit the LLM classifier, and 60% of those get downgraded from Sonnet to Haiku, the classifier pays for itself 15x over.

```
Without ModelGate:  1000 calls x $0.015 avg = $15.00
With heuristic only: 400 Haiku + 600 Sonnet = $10.40 (31% saved)
With LLM classifier: 550 Haiku + 450 Sonnet = $8.25  (45% saved)
                     + 200 classifier calls  = $0.08
                     Net savings: 45%
```

---

## API Design

### Minimal (zero-config)

```typescript
import { ModelGate } from 'modelgate'

const gate = new ModelGate()

// Classify by message content (heuristic)
const result = gate.classify("What flights go to Tokyo?")
// { tier: 'fast', modelId: 'claude-haiku-4-5-20251001', score: 0.15, reasons: ['simple query', 'short message'] }

// Classify by task type (enum)
const result = gate.classifyTask('document_extraction')
// { tier: 'fast', modelId: 'claude-haiku-4-5-20251001' }
```

### Intelligent (with API key)

```typescript
const gate = new ModelGate({
  apiKey: process.env.ANTHROPIC_API_KEY,
  // Haiku classifies ambiguous messages before routing
  intelligent: true,
})

// Ambiguous message — heuristic unsure, LLM classifier kicks in
const result = await gate.classify("Can you help me figure out the best route?")
// Heuristic score: 0.45 (ambiguous)
// LLM classifier: "This is a simple request" → tier: 'fast'
// { tier: 'fast', modelId: 'claude-haiku-4-5-20251001', score: 0.25, reasons: ['llm-classified: simple request'], classifierUsed: true }
```

### With cost tracking

```typescript
const gate = new ModelGate({
  apiKey: process.env.ANTHROPIC_API_KEY,
  tracking: true,
})

// After each API call, record usage
gate.recordUsage({
  taskType: 'chat',
  modelId: 'claude-haiku-4-5-20251001',
  inputTokens: 500,
  outputTokens: 200,
})

// Get stats
const stats = gate.getStats()
// { totalCalls: 1042, totalCost: 4.23, byTier: { fast: 612, quality: 380, expert: 50 }, savedVsAllSonnet: 8.41 }
```

### With provider fallbacks

```typescript
const gate = new ModelGate({
  providers: {
    anthropic: { apiKey: process.env.ANTHROPIC_API_KEY },
    openai: { apiKey: process.env.OPENAI_API_KEY },
  },
  // If Anthropic is down, fall back to OpenAI equivalent
  fallbackChain: true,
})
```

---

## Architecture

```
                    Your App
                       |
                       v
              ┌─────────────────┐
              │    ModelGate     │
              │                 │
              │ ┌─────────────┐ │
              │ │  Heuristic   │ │  Phase 1: free, <1ms
              │ │  Classifier  │ │  Handles 80% of calls
              │ └──────┬──────┘ │
              │        │        │
              │   score 0.3-0.7?│
              │        │        │
              │ ┌──────v──────┐ │
              │ │    LLM      │ │  Phase 2: $0.0004/call
              │ │  Classifier │ │  Handles 20% ambiguous
              │ └──────┬──────┘ │
              │        │        │
              │ ┌──────v──────┐ │
              │ │   Model     │ │  Registry of all models
              │ │  Registry   │ │  with pricing + caps
              │ └──────┬──────┘ │
              │        │        │
              │ ┌──────v──────┐ │
              │ │    Cost     │ │  Optional tracking
              │ │   Tracker   │ │  + analytics
              │ └─────────────┘ │
              └────────┬────────┘
                       │
          ┌────────────┼────────────┐
          v            v            v
    ┌──────────┐ ┌──────────┐ ┌──────────┐
    │ Anthropic│ │  OpenAI  │ │  Google  │
    │  Claude  │ │   GPT    │ │  Gemini  │
    └──────────┘ └──────────┘ └──────────┘
```

---

## Model Registry

Built-in catalog of models with accurate pricing. Updated with each release.

```typescript
// Built-in — no config needed
const MODELS = {
  // Anthropic
  'claude-haiku-4-5-20251001':   { tier: 'fast',    provider: 'anthropic', input: 1.00,  output: 5.00,  maxTokens: 200_000 },
  'claude-sonnet-4-5-20250929':  { tier: 'quality',  provider: 'anthropic', input: 3.00,  output: 15.00, maxTokens: 200_000 },
  'claude-opus-4-6':             { tier: 'expert',   provider: 'anthropic', input: 5.00,  output: 25.00, maxTokens: 200_000 },

  // OpenAI
  'gpt-4o-mini':                 { tier: 'fast',    provider: 'openai',    input: 0.15,  output: 0.60,  maxTokens: 128_000 },
  'gpt-4o':                      { tier: 'quality',  provider: 'openai',    input: 2.50,  output: 10.00, maxTokens: 128_000 },
  'o3':                          { tier: 'expert',   provider: 'openai',    input: 10.00, output: 40.00, maxTokens: 200_000 },

  // Google
  'gemini-2.5-flash':            { tier: 'fast',    provider: 'google',    input: 0.15,  output: 0.60,  maxTokens: 1_000_000 },
  'gemini-2.5-pro':              { tier: 'quality',  provider: 'google',    input: 1.25,  output: 10.00, maxTokens: 1_000_000 },

  // Custom models can be registered
}
```

---

## Three Classification Strategies (Pluggable)

### 1. Message Heuristic (from Travel Planner)

Scores message content 0.0-1.0 based on:
- Message length / word count
- Greeting/acknowledgment patterns (early exit → fast)
- Simple query patterns (single-intent questions)
- Complex keywords (plan, compare, analyze, optimize)
- Multi-step indicators (and then, first...then, if...else)
- Analysis keywords (pros and cons, trade-off, which is better)
- Question count (2+ = complex)
- Structured content (numbered lists, bullet points)
- Domain-specific signals (configurable)

### 2. Task Type Mapping (from Client Review System)

Pre-defined task → tier mapping:
```typescript
gate.classifyTask('sentiment_analysis')    // → fast
gate.classifyTask('content_generation')    // → quality
gate.classifyTask('financial_analysis')    // → expert
```

Ships with sensible defaults. Override per-task:
```typescript
const gate = new ModelGate({
  taskOverrides: {
    'content_generation': 'fast',  // You know your prompts work on Haiku
  }
})
```

### 3. LLM Classifier (new — the differentiator)

When heuristic confidence is low (score 0.3-0.7):
```
System: You are a message complexity classifier. Respond with exactly one word: SIMPLE, MODERATE, or COMPLEX.

SIMPLE = factual lookup, greeting, simple question, yes/no, acknowledgment
MODERATE = multi-step request, comparison, planning with clear constraints
COMPLEX = analysis, strategy, multi-factor reasoning, creative synthesis

User message: "{message}"
```

- Uses Haiku ($1/$5 per 1M tokens)
- ~500 input tokens + 1 output token = $0.0005 per classification
- Cached: identical/similar messages skip re-classification (LRU, 1000 entries)
- Timeout: 500ms max, falls back to heuristic on timeout

---

## Configuration

### Full config object

```typescript
interface ModelGateConfig {
  // API key for intelligent classification (optional)
  apiKey?: string

  // Enable LLM-powered classification for ambiguous messages
  intelligent?: boolean

  // Classification threshold (below = fast, above = quality/expert)
  threshold?: number  // default: 0.4

  // Ambiguity band — scores in this range trigger LLM classifier
  ambiguityBand?: [number, number]  // default: [0.3, 0.7]

  // Provider configs for multi-provider fallback
  providers?: {
    anthropic?: { apiKey: string }
    openai?: { apiKey: string }
    google?: { apiKey: string }
  }

  // Default provider preference order
  providerPreference?: ('anthropic' | 'openai' | 'google')[]

  // Enable cost tracking
  tracking?: boolean

  // Task type overrides
  taskOverrides?: Record<string, ModelTier>

  // Custom heuristic patterns (extend defaults)
  customPatterns?: {
    simple?: RegExp[]
    complex?: RegExp[]
  }

  // Force all traffic to one tier (emergency override)
  forceModel?: ModelTier

  // Classifier model (default: Haiku)
  classifierModel?: string

  // LRU cache size for LLM classifier results
  classifierCacheSize?: number  // default: 1000
}
```

### Environment variables (always respected)

```bash
MODELGATE_FORCE=fast|quality|expert     # Force all traffic to one tier
MODELGATE_INTELLIGENT=true|false        # Enable/disable LLM classifier
MODELGATE_THRESHOLD=0.4                 # Classification threshold
MODELGATE_CLASSIFIER_MODEL=claude-haiku-4-5-20251001
```

---

## Project Structure

```
modelgate/
├── src/
│   ├── index.ts                 — Public exports
│   ├── gate.ts                  — ModelGate class (main entry point)
│   ├── types.ts                 — All type definitions
│   │
│   ├── classifiers/
│   │   ├── heuristic.ts         — Pattern-based scorer (from travel planner)
│   │   ├── llm.ts               — Haiku-powered classifier (new)
│   │   ├── task.ts              — Task-type mapper (from client review)
│   │   └── types.ts             — Classifier interfaces
│   │
│   ├── registry/
│   │   ├── models.ts            — Model catalog with pricing
│   │   ├── providers.ts         — Provider availability checks
│   │   └── defaults.ts          — Default task → tier mappings
│   │
│   ├── tracker/
│   │   ├── cost.ts              — Usage recording + cost calculation
│   │   └── stats.ts             — Aggregation + reporting
│   │
│   └── utils/
│       ├── cache.ts             — LRU cache for classifier results
│       └── env.ts               — Environment variable parsing
│
├── tests/
│   ├── gate.test.ts             — Integration tests
│   ├── heuristic.test.ts        — Heuristic classifier tests
│   ├── llm-classifier.test.ts   — LLM classifier tests (mocked)
│   ├── task-mapper.test.ts      — Task type tests
│   ├── cost-tracker.test.ts     — Cost tracking tests
│   └── registry.test.ts         — Model registry tests
│
├── package.json
├── tsconfig.json
├── biome.json
├── LICENSE                      — MIT
└── README.md
```

---

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Runtime | Bun (Node compat) | Fast, modern, great DX |
| Language | TypeScript (strict) | Type safety, IDE support |
| Testing | bun:test | Zero config, fast |
| Linting | Biome | Fast, opinionated |
| Build | tsup | Clean ESM + CJS dual output |
| Package | npm | Universal distribution |

Zero runtime dependencies. The only optional peer dependency is the Anthropic SDK (for intelligent mode).

---

## Implementation Streams

### Stream A: Core Gate + Heuristic Classifier
- `types.ts` — All interfaces and type definitions
- `gate.ts` — ModelGate class with classify() and classifyTask()
- `classifiers/heuristic.ts` — Port from travel planner, generalized
- `classifiers/task.ts` — Port from client review system, simplified
- `registry/models.ts` — Model catalog
- `registry/defaults.ts` — Default task mappings
- `tests/` — Full test suite for core

### Stream B: LLM Classifier + Cost Tracker
- `classifiers/llm.ts` — Haiku-powered classifier with cache
- `utils/cache.ts` — LRU cache implementation
- `tracker/cost.ts` — Usage recording
- `tracker/stats.ts` — Aggregation and reporting
- `utils/env.ts` — Env var parsing
- `tests/` — LLM classifier + cost tracker tests

### Stream C: Package + README + CI
- `package.json` — npm config, scripts, peer deps
- `tsconfig.json` — Strict TypeScript
- `biome.json` — Linting config
- `README.md` — Full documentation with examples
- `LICENSE` — MIT
- GitHub Actions CI (test + publish)

---

## What This Is NOT

- **Not a proxy/gateway** — ModelGate doesn't make API calls for you. It tells you which model to use. Your existing code calls the API.
- **Not a provider abstraction** — Use Vercel AI SDK, LangChain, or direct SDKs for that. ModelGate sits upstream of those.
- **Not an observability platform** — It tracks costs locally. For production observability, pipe to your existing monitoring.
- **Not ML-based** — No training data, no BERT, no matrix factorization. Heuristics + optional LLM classifier. Simple, predictable, debuggable.

---

## Differentiation Summary

| Feature | RouteLLM | llm-router-ts | OpenRouter | **ModelGate** |
|---------|----------|---------------|------------|---------------|
| TypeScript-native | No | Yes | No | **Yes** |
| Self-hosted | Yes | Yes | No | **Yes** |
| Zero dependencies | No | Yes | N/A | **Yes** |
| Heuristic classifier | No | Yes | No | **Yes** |
| LLM classifier | No | No | Proprietary | **Yes (Haiku)** |
| Hybrid (both) | No | No | No | **Yes** |
| Cost tracking | No | No | Dashboard | **Built-in** |
| Task-type routing | No | No | No | **Yes** |
| Multi-provider | No | No | Yes | **Yes** |
| Env var overrides | No | No | No | **Yes** |
| Reason strings | No | No | No | **Yes** |
| Works offline | Yes | Yes | No | **Yes (heuristic mode)** |
| Price per classification | Free | Free | Model cost | **Free or $0.0004** |

---

## Success Metrics

**Week 1:** npm package published, works with Anthropic models, heuristic classifier covers 80% of messages confidently.

**Week 2:** LLM classifier operational, cost tracker working, multi-provider support.

**Month 1:** 100 npm downloads, used in our three projects, README has real-world cost savings data.

**Month 3:** Community contributions for OpenAI/Google model pricing, custom classifier plugins.
