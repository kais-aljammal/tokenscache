import { z } from "zod";
import type { ChatMessage } from "../types.js";
import { loadPricingConfig, estimateGeminiCacheStorageHourlyUsd } from "../budget/pricing.js";

export const CacheAlignerConfigSchema = z.object({
  normalizeWhitespace: z.boolean().default(true),
  collapseBlankLines: z.boolean().default(true),
  dynamicTailSeparator: z.string().default("\n<!-- tg:dynamic -->"),
  geminiSafetyMargin: z.number().positive().default(2.0),
  maxDynamicTailTokens: z.number().int().positive().default(512),
});

export type CacheAlignerConfig = z.infer<typeof CacheAlignerConfigSchema>;

export interface CacheAlignmentResult {
  stablePrefix: string;
  dynamicTail: string;
  stableHash: string;
  alignmentScore: number;
  geminiStorageAllowed: boolean;
  estimatedStorageUsdPerHour: number;
}

const DATE_PATTERN =
  /\b(?:20\d{2}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]20\d{2}|today|tomorrow|yesterday)\b/gi;
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

/**
 * Split stable cacheable prefix from dynamic tail content and apply Gemini storage gate.
 */
export function alignForProviderCache(
  messages: ChatMessage[],
  options: Partial<CacheAlignerConfig> = {},
  context?: { provider?: string; model?: string; cachedTokenEstimate?: number },
): CacheAlignmentResult {
  const config = CacheAlignerConfigSchema.parse(options);
  const combined = messages.map((m) => `${m.role}: ${m.content}`).join("\n");

  let normalized = combined;
  if (config.normalizeWhitespace) {
    normalized = normalized.replace(/\s+/g, " ").trim();
  }
  if (config.collapseBlankLines) {
    normalized = normalized.replace(/\n{3,}/g, "\n\n");
  }

  const dynamicMatches = [
    ...normalized.matchAll(DATE_PATTERN),
    ...normalized.matchAll(UUID_PATTERN),
  ].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

  let splitIndex = normalized.length;
  if (dynamicMatches.length > 0) {
    splitIndex = dynamicMatches[0]!.index ?? normalized.length;
  } else if (estimateTokens(normalized) > config.maxDynamicTailTokens) {
    splitIndex = Math.max(0, normalized.length - config.maxDynamicTailTokens * 4);
  }

  const stablePrefix = normalized.slice(0, splitIndex).trimEnd();
  const dynamicTail = normalized.slice(splitIndex).trimStart();
  const stableHash = hashString(stablePrefix);

  const alignmentScore =
    stablePrefix.length === 0 ? 0 : stablePrefix.length / Math.max(normalized.length, 1);

  const cachedTokenEstimate = context?.cachedTokenEstimate ?? estimateTokens(stablePrefix);
  const estimatedStorageUsdPerHour = estimateGeminiCacheStorageHourlyUsd(
    context?.model ?? "gemini-2.0-flash",
    cachedTokenEstimate,
  );

  const geminiStorageAllowed =
    context?.provider !== "google" && context?.provider !== "gemini"
      ? true
      : estimatedStorageUsdPerHour * config.geminiSafetyMargin <= loadGeminiStorageBudgetCap();

  return {
    stablePrefix,
    dynamicTail: dynamicTail ? `${config.dynamicTailSeparator}${dynamicTail}` : "",
    stableHash,
    alignmentScore,
    geminiStorageAllowed,
    estimatedStorageUsdPerHour,
  };
}

function loadGeminiStorageBudgetCap(): number {
  try {
    const pricing = loadPricingConfig();
    return pricing._meta.geminiStorageBudgetCapUsd ?? 0.05;
  } catch {
    return 0.05;
  }
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function hashString(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
