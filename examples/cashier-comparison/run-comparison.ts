/**
 * Side-by-side comparison: agent WITH TokensCache vs WITHOUT.
 * Task: build a simple cashier system (code only).
 *
 * Run: npm run cashier-compare
 */

import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TokensCache } from "../../src/index.js";
import { AGENT_TURNS, buildMessages } from "./agent-prompts.js";
import { ARTIFACT_CODE, MeteredMockProvider } from "./mock-llm.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "results");

interface RunResult {
  mode: "with-tokenscache" | "without-tokenscache";
  upstreamCalls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheHits: number;
  cacheMisses: number;
  artifacts: Record<string, string>;
  durationMs: number;
}

async function runWithTokensCache(): Promise<RunResult> {
  const dbPath = join(OUT, "with-tg.db");
  if (existsSync(dbPath)) rmSync(dbPath, { force: true });

  const provider = new MeteredMockProvider();
  const guard = new TokensCache({
    config: {
      providers: { mock: {} },
      cache: {
        l1: { maxEntries: 200 },
        agentArtifactScope: true,
        semantic: {
          highThreshold: 0.85,
          grayZoneMin: 0.65,
          matchPolicy: "verified-decision",
        },
      },
      optimizer: {
        toolPruning: true,
        historyCompression: false,
        outputShaping: false,
        cacheAlignment: false,
      },
    },
    sessionId: "cashier-with-tg",
    dbPath,
  });

  guard.registerProvider(provider);
  const artifacts: Record<string, string> = {};
  const start = performance.now();

  for (const turn of AGENT_TURNS) {
    const response = await guard.chat({
      provider: "mock",
      model: "gpt-4o-mini",
      messages: buildMessages(turn),
      metadata: { artifact: turn.artifact, turnId: turn.id },
    });
    artifacts[turn.artifact] = response.content;
  }

  const stats = guard.getCacheStats();
  const meter = provider.snapshot();
  guard.close();

  return {
    mode: "with-tokenscache",
    upstreamCalls: meter.upstreamCalls,
    inputTokens: meter.inputTokens,
    outputTokens: meter.outputTokens,
    totalTokens: meter.totalTokens,
    cacheHits: stats.hits,
    cacheMisses: stats.misses,
    artifacts,
    durationMs: Math.round(performance.now() - start),
  };
}

async function runWithoutTokensCache(): Promise<RunResult> {
  const provider = new MeteredMockProvider();
  const artifacts: Record<string, string> = {};
  const start = performance.now();
  let cacheHits = 0;
  let cacheMisses = 0;

  for (const turn of AGENT_TURNS) {
    cacheMisses += 1;
    const response = await provider.chat({
      provider: "mock",
      model: "gpt-4o-mini",
      messages: buildMessages(turn),
      metadata: { artifact: turn.artifact, turnId: turn.id },
    });
    artifacts[turn.artifact] = response.content;
  }

  const meter = provider.snapshot();

  return {
    mode: "without-tokenscache",
    upstreamCalls: meter.upstreamCalls,
    inputTokens: meter.inputTokens,
    outputTokens: meter.outputTokens,
    totalTokens: meter.totalTokens,
    cacheHits,
    cacheMisses,
    artifacts,
    durationMs: Math.round(performance.now() - start),
  };
}

function writeOutput(dir: string, artifacts: Record<string, string>): void {
  mkdirSync(dir, { recursive: true });
  for (const [name, code] of Object.entries(artifacts)) {
    const ext = name === "tests" ? "test.ts" : `${name}.ts`;
    writeFileSync(join(dir, ext), code + "\n", "utf-8");
  }
}

interface QualityScore {
  completeness: number;
  correctness: number;
  structure: number;
  overall: number;
  notes: string[];
}

function rateOutput(artifacts: Record<string, string>): QualityScore {
  const required = ["product", "cart", "checkout", "tax", "payment", "receipt", "inventory", "service", "tests"];
  const present = required.filter((k) => artifacts[k]?.length > 20);
  const completeness = (present.length / required.length) * 10;

  const notes: string[] = [];
  let correctness = 10;
  if (!artifacts.service?.includes("CashierService")) {
    correctness -= 2;
    notes.push("Missing CashierService orchestration");
  }
  if (!artifacts.inventory?.includes("stock")) {
    correctness -= 1;
    notes.push("Weak inventory guard");
  }
  if (!artifacts.tests?.includes("describe")) {
    correctness -= 1;
    notes.push("Tests incomplete");
  }

  let structure = 10;
  for (const key of present) {
    if (!artifacts[key].includes("export")) {
      structure -= 0.5;
    }
  }

  const overall = Math.round(((completeness + correctness + structure) / 3) * 10) / 10;
  return { completeness, correctness, structure, overall, notes };
}

function artifactsIdentical(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if ((a[k] ?? "").trim() !== (b[k] ?? "").trim()) return false;
  }
  return true;
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });

  console.log("Cashier System — TokensCache A/B Comparison");
  console.log("==========================================\n");
  console.log(`Task: ${AGENT_TURNS.length} agent turns building a TypeScript cashier (no UI)\n`);

  const withTg = await runWithTokensCache();
  const withoutTg = await runWithoutTokensCache();

  writeOutput(join(OUT, "with-tokenscache"), withTg.artifacts);
  writeOutput(join(OUT, "without-tokenscache"), withoutTg.artifacts);

  const savedTokens = withoutTg.totalTokens - withTg.totalTokens;
  const savedPct = withoutTg.totalTokens > 0 ? (savedTokens / withoutTg.totalTokens) * 100 : 0;
  const savedCalls = withoutTg.upstreamCalls - withTg.upstreamCalls;

  const qualityWith = rateOutput(withTg.artifacts);
  const qualityWithout = rateOutput(withoutTg.artifacts);
  const sameOutput = artifactsIdentical(withTg.artifacts, withoutTg.artifacts);

  const report = {
    task: "Simple cashier system (TypeScript, no UI)",
    turns: AGENT_TURNS.length,
    withTokensCache: { ...withTg, quality: qualityWith },
    withoutTokensCache: { ...withoutTg, quality: qualityWithout },
    savings: {
      tokensSaved: savedTokens,
      percentSaved: Math.round(savedPct * 10) / 10,
      upstreamCallsSaved: savedCalls,
      hitRate: Math.round((withTg.cacheHits / AGENT_TURNS.length) * 1000) / 10,
    },
    outputIdentical: sameOutput,
  };

  writeFileSync(join(OUT, "comparison.json"), JSON.stringify(report, null, 2), "utf-8");

  console.log("WITH TokensCache");
  console.log("---------------");
  console.log(`  Upstream LLM calls:  ${withTg.upstreamCalls}`);
  console.log(`  Input tokens billed: ${withTg.inputTokens.toLocaleString()}`);
  console.log(`  Output tokens billed:${withTg.outputTokens.toLocaleString()}`);
  console.log(`  Total tokens billed: ${withTg.totalTokens.toLocaleString()}`);
  console.log(`  Cache hits / misses: ${withTg.cacheHits} / ${withTg.cacheMisses}`);
  console.log(`  Quality score:       ${qualityWith.overall}/10`);
  console.log(`  Duration:            ${withTg.durationMs}ms\n`);

  console.log("WITHOUT TokensCache");
  console.log("------------------");
  console.log(`  Upstream LLM calls:  ${withoutTg.upstreamCalls}`);
  console.log(`  Input tokens billed: ${withoutTg.inputTokens.toLocaleString()}`);
  console.log(`  Output tokens billed:${withoutTg.outputTokens.toLocaleString()}`);
  console.log(`  Total tokens billed: ${withoutTg.totalTokens.toLocaleString()}`);
  console.log(`  Cache hits / misses: 0 / ${withoutTg.cacheMisses}`);
  console.log(`  Quality score:       ${qualityWithout.overall}/10`);
  console.log(`  Duration:            ${withoutTg.durationMs}ms\n`);

  console.log("SAVINGS");
  console.log("-------");
  console.log(`  Tokens saved:        ${savedTokens.toLocaleString()} (${savedPct.toFixed(1)}%)`);
  console.log(`  LLM calls avoided:   ${savedCalls}`);
  console.log(`  Cache hit rate:      ${report.savings.hitRate}%`);
  console.log(`  Output identical:    ${sameOutput ? "yes" : "no"}`);
  console.log(`\nResults written to: ${OUT}/comparison.json`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
