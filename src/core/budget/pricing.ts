import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { TokenUsage } from "../types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PRICING_PATH = join(__dirname, "../../../config/pricing.json");

const TierRatesSchema = z.record(z.string(), z.number());

const PricingConfigSchema = z.object({
  _meta: z
    .object({
      last_verified: z.string().optional(),
      verify_before_relying: z.boolean().optional(),
      note: z.string().optional(),
      geminiStorageBudgetCapUsd: z.number().positive().optional(),
    })
    .passthrough(),
  anthropic: z.record(z.string(), TierRatesSchema),
  openai: z.record(z.string(), TierRatesSchema),
  google: z.record(z.string(), TierRatesSchema),
});

export type PricingConfig = z.infer<typeof PricingConfigSchema>;

export interface CostEstimate {
  inputUsd: number;
  outputUsd: number;
  cacheReadUsd: number;
  cacheWriteUsd: number;
  cacheStorageUsd: number;
  totalUsd: number;
}

let cachedPricing: PricingConfig | null = null;

export function loadPricingConfig(path = DEFAULT_PRICING_PATH): PricingConfig {
  if (cachedPricing && path === DEFAULT_PRICING_PATH) return cachedPricing;
  const raw = readFileSync(path, "utf-8");
  const parsed = PricingConfigSchema.parse(JSON.parse(raw));
  if (path === DEFAULT_PRICING_PATH) cachedPricing = parsed;
  return parsed;
}

export function clearPricingCache(): void {
  cachedPricing = null;
}

export function resolveModelTier(provider: string, model: string): string {
  const normalized = model.toLowerCase();
  const providerKey = provider.toLowerCase();

  if (providerKey === "anthropic") {
    if (normalized.includes("opus")) return "opus_tier";
    if (normalized.includes("haiku")) return "haiku_tier";
    return "sonnet_tier";
  }

  if (providerKey === "openai") {
    if (normalized.includes("nano") || normalized.includes("mini")) return "nano_tier";
    if (normalized.includes("4o") || normalized.includes("o1") || normalized.includes("o3")) {
      return "flagship_tier";
    }
    return "mid_tier";
  }

  if (providerKey === "google" || providerKey === "gemini") {
    if (normalized.includes("lite")) return "flash_lite_tier";
    if (normalized.includes("flash")) return "flash_tier";
    return "pro_tier";
  }

  return "mid_tier";
}

function millionTokenCost(tokens: number, usdPerMillion: number): number {
  return (tokens / 1_000_000) * usdPerMillion;
}

export function estimateUsageCost(
  provider: string,
  model: string,
  usage: TokenUsage,
  pricing: PricingConfig = loadPricingConfig(),
): CostEstimate {
  const tier = resolveModelTier(provider, model);
  const providerKey = provider.toLowerCase();

  let rates: Record<string, number>;
  if (providerKey === "anthropic") {
    rates = pricing.anthropic[tier] ?? pricing.anthropic.sonnet_tier;
  } else if (providerKey === "openai") {
    rates = pricing.openai[tier] ?? pricing.openai.mid_tier;
  } else {
    rates = pricing.google[tier] ?? pricing.google.flash_tier;
  }

  const inputUsd = millionTokenCost(usage.inputTokens, rates.input ?? 0);
  const outputUsd = millionTokenCost(usage.outputTokens, rates.output ?? 0);

  const cacheReadUsd = millionTokenCost(
    usage.cacheReadTokens ?? 0,
    rates.cache_read ?? rates.cached_read ?? rates.cached_input ?? 0,
  );

  const cacheWriteUsd = millionTokenCost(
    usage.cacheWriteTokens ?? 0,
    rates.cache_write_5m ?? 0,
  );

  const cacheStorageUsd = usage.cacheStorageUsd ?? 0;

  return {
    inputUsd,
    outputUsd,
    cacheReadUsd,
    cacheWriteUsd,
    cacheStorageUsd,
    totalUsd: inputUsd + outputUsd + cacheReadUsd + cacheWriteUsd + cacheStorageUsd,
  };
}

export function estimateGeminiCacheStorageHourlyUsd(model: string, cachedTokens: number): number {
  const pricing = loadPricingConfig();
  const tier = resolveModelTier("google", model);
  const rates = pricing.google[tier] ?? pricing.google.flash_tier;
  const perMillionPerHour = rates.cache_storage_usd_per_million_tokens_per_hour ?? 1.0;
  return millionTokenCost(cachedTokens, perMillionPerHour);
}

export function estimateRequestCost(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens = 0,
): number {
  return estimateUsageCost(provider, model, {
    inputTokens,
    outputTokens,
  }).totalUsd;
}
