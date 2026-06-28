import { z } from "zod";

export const BudgetActionSchema = z.enum(["warn", "downgrade", "block"]);
export type BudgetAction = z.infer<typeof BudgetActionSchema>;

export const MatchPolicySchema = z.enum(["static-threshold", "verified-decision"]);
export type MatchPolicy = z.infer<typeof MatchPolicySchema>;

export const BudgetLimitSchema = z.object({
  usd: z.number().positive(),
  action: BudgetActionSchema,
});

export const TokenGuardConfigSchema = z.object({
  providers: z.record(
    z.string(),
    z.object({
      apiKey: z.string().optional(),
      baseUrl: z.string().url().optional(),
    }),
  ),
  budget: z
    .object({
      daily: BudgetLimitSchema.optional(),
      session: BudgetLimitSchema.optional(),
      hard: BudgetLimitSchema.optional(),
      includeCacheStorageHoldingCosts: z.boolean().default(true),
    })
    .optional(),
  cache: z
    .object({
      l1: z.object({ maxEntries: z.number().int().positive().default(500) }).optional(),
      l2: z
        .object({
          dbName: z.string().default("tokenguard"),
          maxSizeMB: z.number().positive().default(100),
        })
        .optional(),
      l3: z
        .object({
          dbPath: z.string().default("./tokenguard.db"),
          maxSizeMB: z.number().positive().default(1000),
        })
        .optional(),
      semantic: z
        .object({
          highThreshold: z.number().min(0).max(1).default(0.92),
          grayZoneMin: z.number().min(0).max(1).default(0.7),
          matchPolicy: MatchPolicySchema.default("static-threshold"),
        })
        .optional(),
      gemini: z
        .object({
          explicitCacheSafetyMargin: z.number().positive().default(2.0),
        })
        .optional(),
      /** When true, cache hits on metadata.artifact for agent file/codegen workflows. */
      agentArtifactScope: z.boolean().default(false),
    })
    .optional(),
  optimizer: z
    .object({
      toolPruning: z.boolean().default(true),
      historyCompression: z.boolean().default(true),
      compressionTrigger: z.number().min(0).max(1).default(0.6),
      outputShaping: z.boolean().default(true),
      outputShapingTrigger: z.number().min(0).max(1).default(0.25),
      outputShapingHoldout: z.number().min(0).max(1).default(0.1),
      cacheAlignment: z.boolean().default(true),
    })
    .optional(),
});

export type TokenGuardConfig = z.infer<typeof TokenGuardConfigSchema>;

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface ChatRequest {
  provider: string;
  model: string;
  messages: ChatMessage[];
  tools?: unknown[];
  stream?: boolean;
  metadata?: Record<string, unknown>;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cacheStorageUsd?: number;
}

export interface ChatResponse {
  id: string;
  content: string;
  model: string;
  usage: TokenUsage;
  cached: boolean;
  cacheLayer?: "L1" | "L2" | "L3" | "semantic" | "artifact";
  metadata?: Record<string, unknown>;
}

export interface BudgetStatus {
  spentUsd: number;
  limitUsd: number;
  action: BudgetAction | null;
  resetAt?: string;
}
