/**
 * Token waste audit — summarizes ledger spend and cache efficiency across sessions.
 * Run: npm run audit [-- --db ./tokenguard.db]
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { openDatabase } from "../src/core/db/index.js";
import { loadPricingConfig, estimateUsageCost } from "../src/core/budget/pricing.js";

interface SessionRow {
  id: string;
  started_at: string;
  total_cost_usd: number;
}

interface LedgerRow {
  session_id: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cache_storage_usd: number;
  cost_usd: number;
}

function parseDbArg(): string {
  const idx = process.argv.indexOf("--db");
  if (idx !== -1 && process.argv[idx + 1]) {
    return resolve(process.argv[idx + 1]!);
  }
  return resolve(process.cwd(), "tokenguard.db");
}

function formatUsd(value: number): string {
  return `$${value.toFixed(4)}`;
}

async function main(): Promise<void> {
  const dbPath = parseDbArg();

  if (!existsSync(dbPath)) {
    console.error(`Database not found: ${dbPath}`);
    console.error("Run an agent with TokenGuard.init() first, or pass --db <path>.");
    process.exitCode = 1;
    return;
  }

  const { adapter, close } = await openDatabase({ dbPath, loadPricing: false });
  const pricing = loadPricingConfig();

  const sessions = adapter
    .prepare(
      `SELECT id, started_at, total_cost_usd FROM sessions ORDER BY total_cost_usd DESC`,
    )
    .all() as SessionRow[];

  const entries = adapter
    .prepare(
      `SELECT session_id, provider, model, input_tokens, output_tokens,
              cache_read_tokens, cache_write_tokens, cache_storage_usd, cost_usd
       FROM ledger_entries
       ORDER BY created_at ASC`,
    )
    .all() as LedgerRow[];

  close();

  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCost = 0;
  let hypotheticalFullCost = 0;
  let cacheSavingsUsd = 0;

  for (const row of entries) {
    totalInput += row.input_tokens;
    totalOutput += row.output_tokens;
    totalCacheRead += row.cache_read_tokens;
    totalCost += row.cost_usd;

    const fullPrice = estimateUsageCost(row.provider, row.model, {
      inputTokens: row.input_tokens + row.cache_read_tokens,
      outputTokens: row.output_tokens,
      cacheReadTokens: 0,
    }, pricing).totalUsd;

    const actual = estimateUsageCost(row.provider, row.model, {
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cacheReadTokens: row.cache_read_tokens,
    }, pricing).totalUsd;

    hypotheticalFullCost += fullPrice;
    cacheSavingsUsd += Math.max(0, fullPrice - actual);
  }

  const uncachedInputTokens = Math.max(0, totalInput - totalCacheRead);
  const cacheHitRatio =
    totalInput + totalCacheRead > 0 ? totalCacheRead / (totalInput + totalCacheRead) : 0;

  console.log("TokenGuard Token Waste Audit");
  console.log("============================");
  console.log(`Database:       ${dbPath}`);
  console.log(`Sessions:       ${sessions.length}`);
  console.log(`Ledger entries: ${entries.length}`);
  console.log("");
  console.log("Aggregate usage");
  console.log(`  Input tokens:      ${totalInput.toLocaleString()}`);
  console.log(`  Output tokens:     ${totalOutput.toLocaleString()}`);
  console.log(`  Cache-read tokens: ${totalCacheRead.toLocaleString()}`);
  console.log(`  Uncached input:    ${uncachedInputTokens.toLocaleString()}`);
  console.log(`  Cache hit ratio:   ${(cacheHitRatio * 100).toFixed(1)}%`);
  console.log("");
  console.log("Cost summary");
  console.log(`  Recorded spend:    ${formatUsd(totalCost)}`);
  console.log(`  Cache savings est: ${formatUsd(cacheSavingsUsd)}`);
  console.log(`  Waste indicator:   ${formatUsd(hypotheticalFullCost - cacheSavingsUsd)} (uncached full-price equivalent)`);
  console.log("");

  if (sessions.length === 0) {
    console.log("No sessions recorded yet.");
    return;
  }

  console.log("Top sessions by spend");
  for (const session of sessions.slice(0, 10)) {
    const sessionEntries = entries.filter((e) => e.session_id === session.id);
    const sessionInput = sessionEntries.reduce((sum, e) => sum + e.input_tokens, 0);
    const sessionCacheRead = sessionEntries.reduce((sum, e) => sum + e.cache_read_tokens, 0);
    const wastePct =
      sessionInput > 0 ? ((sessionInput - sessionCacheRead) / sessionInput) * 100 : 0;

    console.log(
      `  ${session.id.slice(0, 8)}…  ${formatUsd(session.total_cost_usd)}  ` +
        `${sessionEntries.length} reqs  uncached ${wastePct.toFixed(0)}%`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
