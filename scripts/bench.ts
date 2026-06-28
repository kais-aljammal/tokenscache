/**
 * TokenGuard cache benchmark — simulates 200 prompts with 30% semantic overlap.
 * Run: npm run bench
 */

import { CacheRouter } from "../src/core/cache/cache-router.js";
import { SemanticMatcher } from "../src/core/cache/semantic-match.js";
import { HashEmbeddingService } from "../src/core/cache/embedding.js";
import type { ChatRequest, ChatResponse } from "../src/core/types.js";

const TOTAL_PROMPTS = 200;
const OVERLAP_RATIO = 0.3;
const UNIQUE_COUNT = Math.round(TOTAL_PROMPTS * (1 - OVERLAP_RATIO));
const VARIANT_COUNT = TOTAL_PROMPTS - UNIQUE_COUNT;

const TOPICS = [
  "kubernetes deployment",
  "typescript generics",
  "sqlite indexing",
  "react state management",
  "oauth2 refresh tokens",
  "vector embeddings",
  "budget forecasting",
  "log aggregation",
  "rate limiting",
  "semantic search",
  "prompt caching",
  "token pricing",
  "agent orchestration",
  "mcp tool routing",
  "indexeddb persistence",
];

function uniquePrompt(index: number): string {
  const topic = TOPICS[index % TOPICS.length]!;
  return `Explain ${topic} best practices for production systems (case ${index}).`;
}

function semanticVariant(base: string, variantIndex: number): string {
  const suffix = variantIndex % 3;
  if (suffix === 0) return base.replace("Explain", "Please explain");
  if (suffix === 1) return `${base} Keep it concise.`;
  return base.replace("production systems", "prod environments");
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

function buildPromptSet(): string[] {
  const bases = Array.from({ length: UNIQUE_COUNT }, (_, i) => uniquePrompt(i));
  const variants = Array.from({ length: VARIANT_COUNT }, (_, i) => {
    const base = bases[i % bases.length]!;
    return semanticVariant(base, i);
  });
  return shuffle([...bases, ...variants]);
}

function mockResponse(content: string): ChatResponse {
  return {
    id: `mock-${content.length}`,
    content: `Answer for: ${content.slice(0, 48)}…`,
    model: "gpt-4o-mini",
    usage: { inputTokens: 120, outputTokens: 80 },
    cached: false,
  };
}

async function main(): Promise<void> {
  const semantic = new SemanticMatcher({
    highThreshold: 0.85,
    grayZoneMin: 0.65,
    embeddingProvider: new HashEmbeddingService(128),
  });

  const router = new CacheRouter({ l1MaxEntries: 500 }, { semantic });

  const prompts = buildPromptSet();
  let hits = 0;
  let misses = 0;
  const layerCounts: Record<string, number> = {};

  const started = performance.now();

  for (const prompt of prompts) {
    const request: ChatRequest = {
      provider: "openai",
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    };

    const lookup = await router.lookup(request);
    if (lookup.hit) {
      hits++;
      const layer = lookup.layer ?? "unknown";
      layerCounts[layer] = (layerCounts[layer] ?? 0) + 1;
    } else {
      misses++;
      await router.store(request, mockResponse(prompt));
    }
  }

  const elapsedMs = performance.now() - started;
  const hitRate = hits / prompts.length;

  console.log("TokenGuard Cache Benchmark");
  console.log("==========================");
  console.log(`Prompts:        ${prompts.length}`);
  console.log(`Unique bases:   ${UNIQUE_COUNT}`);
  console.log(`Semantic variants: ${VARIANT_COUNT} (${(OVERLAP_RATIO * 100).toFixed(0)}% overlap target)`);
  console.log(`Cache hits:     ${hits}`);
  console.log(`Cache misses:   ${misses}`);
  console.log(`Hit rate:       ${(hitRate * 100).toFixed(1)}%`);
  console.log(`Elapsed:        ${elapsedMs.toFixed(0)} ms`);
  console.log("Hits by layer:");
  for (const [layer, count] of Object.entries(layerCounts).sort()) {
    console.log(`  ${layer}: ${count}`);
  }

  if (hitRate < OVERLAP_RATIO * 0.5) {
    console.warn(
      `\nWarning: hit rate ${(hitRate * 100).toFixed(1)}% is well below the ${(OVERLAP_RATIO * 100).toFixed(0)}% overlap design target.`,
    );
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
