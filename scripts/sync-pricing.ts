/**
 * Verify config/pricing.json freshness against a 30-day threshold.
 * Run: npm run sync-pricing [-- --path ./config/pricing.json] [-- --threshold-days 30]
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { openDatabase, syncPricingMetadata } from "../src/core/db/index.js";
import { loadPricingConfig, clearPricingCache } from "../src/core/budget/pricing.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = join(__dirname, "../config/pricing.json");
const DEFAULT_THRESHOLD_DAYS = 30;

function parseArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

async function main(): Promise<void> {
  const pricingPath = resolve(parseArg("--path") ?? DEFAULT_PATH);
  const thresholdDays = Number(parseArg("--threshold-days") ?? DEFAULT_THRESHOLD_DAYS);
  const dbPath = parseArg("--db");

  if (!existsSync(pricingPath)) {
    console.error(`Pricing file not found: ${pricingPath}`);
    process.exitCode = 1;
    return;
  }

  clearPricingCache();
  const pricing = loadPricingConfig(pricingPath);
  const lastVerifiedRaw = pricing._meta.last_verified;

  if (!lastVerifiedRaw) {
    console.error("Missing _meta.last_verified in pricing.json");
    process.exitCode = 1;
    return;
  }

  const lastVerified = new Date(`${lastVerifiedRaw}T00:00:00Z`);
  const today = new Date();
  const ageDays = daysBetween(lastVerified, today);
  const stale = ageDays > thresholdDays;

  console.log("TokensCache Pricing Freshness Check");
  console.log("==================================");
  console.log(`File:            ${pricingPath}`);
  console.log(`Last verified:   ${lastVerifiedRaw}`);
  console.log(`Age (days):      ${ageDays}`);
  console.log(`Threshold:       ${thresholdDays} days`);
  console.log(`Status:          ${stale ? "STALE — update required" : "OK"}`);

  if (pricing._meta.note) {
    console.log(`Note:            ${pricing._meta.note.slice(0, 120)}…`);
  }

  if (dbPath) {
    const { adapter, close } = await openDatabase({ dbPath, loadPricing: false });
    const raw = readFileSync(pricingPath, "utf-8");
    syncPricingMetadata(adapter, lastVerifiedRaw, raw);
    close();
    console.log(`Synced metadata to database: ${dbPath}`);
  }

  if (stale) {
    console.error(
      `\nPricing snapshot is ${ageDays} days old (limit ${thresholdDays}). Re-verify provider rates and update config/pricing.json.`,
    );
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
