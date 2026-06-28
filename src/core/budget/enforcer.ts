import type { DatabaseAdapter } from "../db/schema.js";
import type { BudgetAction, ChatRequest, TokenGuardConfig, TokenUsage } from "../types.js";
import { BudgetLedger, checkBudgetLimits, type BudgetCheckResult } from "./ledger.js";
import { estimateRequestCost, estimateUsageCost } from "./pricing.js";

export interface BudgetEnforcerOptions {
  adapter: DatabaseAdapter;
  config: TokenGuardConfig;
  sessionId: string;
}

export interface BudgetEnforcementResult extends BudgetCheckResult {
  estimatedCostUsd: number;
  downgraded?: boolean;
  model?: string;
}

/**
 * Real-dollar budget enforcement using ledger + pricing config.
 */
export class BudgetEnforcer {
  private readonly ledger: BudgetLedger;
  private readonly config: TokenGuardConfig;
  private readonly sessionId: string;

  constructor(options: BudgetEnforcerOptions) {
    this.ledger = new BudgetLedger(options.adapter);
    this.config = options.config;
    this.sessionId = options.sessionId;
    this.ledger.ensureSession(this.sessionId);
  }

  estimateRequestCost(request: ChatRequest, usageEstimate?: Partial<TokenUsage>): number {
    const inputTokens = usageEstimate?.inputTokens ?? estimateTokensFromMessages(request.messages);
    const outputTokens = usageEstimate?.outputTokens ?? Math.ceil(inputTokens * 0.25);
    return estimateRequestCost(request.provider, request.model, inputTokens, outputTokens);
  }

  /** Current spend and limit state without projecting a hypothetical request cost. */
  getStatus(): BudgetCheckResult {
    return this.evaluateBudget(0);
  }

  check(request: ChatRequest, usageEstimate?: Partial<TokenUsage>): BudgetEnforcementResult {
    const estimatedCostUsd = this.estimateRequestCost(request, usageEstimate);
    return { ...this.evaluateBudget(estimatedCostUsd), estimatedCostUsd };
  }

  private evaluateBudget(estimatedCostUsd: number): BudgetCheckResult {
    const dailySince = new Date();
    dailySince.setUTCHours(0, 0, 0, 0);

    const sessionSpend = this.ledger.getSessionSpend(this.sessionId).totalUsd;
    const dailySpend = this.ledger.getDailySpend(dailySince.toISOString()).totalUsd;

    const limits = this.config.budget;
    if (!limits) {
      return {
        allowed: true,
        action: null,
        spent: sessionSpend,
        limit: Infinity,
      };
    }

    const hardCheck = limits.hard
      ? checkBudgetLimits(sessionSpend, estimatedCostUsd, { hard: limits.hard })
      : null;
    if (hardCheck?.action) {
      return hardCheck;
    }

    const sessionCheck = limits.session
      ? checkBudgetLimits(sessionSpend, estimatedCostUsd, { session: limits.session })
      : null;
    if (sessionCheck && sessionCheck.action) {
      return sessionCheck;
    }

    const dailyCheck = limits.daily
      ? checkBudgetLimits(dailySpend, estimatedCostUsd, { daily: limits.daily })
      : null;
    if (dailyCheck && dailyCheck.action) {
      return { ...dailyCheck, spent: dailySpend };
    }

    return {
      allowed: true,
      action: null,
      spent: sessionSpend,
      limit: limits.session?.usd ?? limits.daily?.usd ?? Infinity,
    };
  }

  record(
    request: ChatRequest,
    usage: TokenUsage,
    requestId?: string,
    includeCacheStorage = true,
  ): number {
    const cost = estimateUsageCost(request.provider, request.model, {
      ...usage,
      cacheStorageUsd: includeCacheStorage ? usage.cacheStorageUsd ?? 0 : 0,
    });

    this.ledger.record({
      sessionId: this.sessionId,
      provider: request.provider,
      model: request.model,
      usage,
      costUsd: cost.totalUsd,
      requestId,
    });

    return cost.totalUsd;
  }

  applyAction(request: ChatRequest, action: BudgetAction | null): ChatRequest {
    if (!action || action === "warn") return request;
    if (action === "block") {
      throw new Error("[TokenGuard] Budget exhausted — request blocked");
    }
    return {
      ...request,
      model: downgradeModel(request.provider, request.model),
      metadata: {
        ...request.metadata,
        budgetDowngraded: true,
      },
    };
  }
}

function downgradeModel(provider: string, model: string): string {
  const normalized = model.toLowerCase();
  const providerKey = provider.toLowerCase();

  if (providerKey === "anthropic") {
    if (normalized.includes("opus") || normalized.includes("sonnet")) return "claude-3-5-haiku-latest";
    return model;
  }
  if (providerKey === "openai") {
    if (!normalized.includes("mini") && !normalized.includes("nano")) return "gpt-4o-mini";
    return model;
  }
  if (providerKey === "google" || providerKey === "gemini") {
    if (normalized.includes("pro")) return "gemini-2.0-flash";
    if (normalized.includes("flash") && !normalized.includes("lite")) return "gemini-2.0-flash-lite";
    return model;
  }
  return model;
}

function estimateTokensFromMessages(messages: Array<{ content: string }>): number {
  const chars = messages.reduce((sum, m) => sum + m.content.length, 0);
  return Math.ceil(chars / 4);
}
