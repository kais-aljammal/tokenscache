/**
 * Budget ledger — session/dollar accounting pattern inspired by AgentBudget (Apache-2.0, patterns only).
 * Python-only source; this is a TypeScript reimplementation of the ledger design.
 */

import type { DatabaseAdapter } from "../db/schema.js";
import type { BudgetAction, TokenUsage } from "../types.js";

export interface LedgerRecordInput {
  sessionId: string;
  provider: string;
  model: string;
  usage: TokenUsage;
  costUsd: number;
  requestId?: string;
}

export interface SpendSummary {
  totalUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheStorageUsd: number;
}

export class BudgetLedger {
  private readonly db: DatabaseAdapter;

  constructor(db: DatabaseAdapter) {
    this.db = db;
  }

  /**
   * Record a completed request's token and dollar costs.
   */
  record(input: LedgerRecordInput): void {
    const { sessionId, provider, model, usage, costUsd, requestId } = input;

    this.db
      .prepare(
        `INSERT INTO ledger_entries
         (session_id, provider, model, input_tokens, output_tokens,
          cache_read_tokens, cache_write_tokens, cache_storage_usd, cost_usd, request_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sessionId,
        provider,
        model,
        usage.inputTokens,
        usage.outputTokens,
        usage.cacheReadTokens ?? 0,
        usage.cacheWriteTokens ?? 0,
        usage.cacheStorageUsd ?? 0,
        costUsd,
        requestId ?? null,
      );

    this.db
      .prepare(`UPDATE sessions SET total_cost_usd = total_cost_usd + ? WHERE id = ?`)
      .run(costUsd, sessionId);
  }

  /**
   * Sum spend for a session since a given ISO timestamp (for daily budgets).
   */
  getSessionSpend(sessionId: string, since?: string): SpendSummary {
    const row = this.db
      .prepare(
        `SELECT
           COALESCE(SUM(cost_usd), 0) as totalUsd,
           COALESCE(SUM(input_tokens), 0) as inputTokens,
           COALESCE(SUM(output_tokens), 0) as outputTokens,
           COALESCE(SUM(cache_storage_usd), 0) as cacheStorageUsd
         FROM ledger_entries
         WHERE session_id = ?
         ${since ? "AND created_at >= ?" : ""}`,
      )
      .get(...(since ? [sessionId, since] : [sessionId])) as SpendSummary;

    return row;
  }

  /**
   * Sum spend across all sessions since a given ISO timestamp.
   */
  getDailySpend(since: string): SpendSummary {
    const row = this.db
      .prepare(
        `SELECT
           COALESCE(SUM(cost_usd), 0) as totalUsd,
           COALESCE(SUM(input_tokens), 0) as inputTokens,
           COALESCE(SUM(output_tokens), 0) as outputTokens,
           COALESCE(SUM(cache_storage_usd), 0) as cacheStorageUsd
         FROM ledger_entries
         WHERE created_at >= ?`,
      )
      .get(since) as SpendSummary;

    return row;
  }

  ensureSession(sessionId: string): void {
    this.db.prepare(`INSERT OR IGNORE INTO sessions (id) VALUES (?)`).run(sessionId);
  }
}

export interface BudgetLimit {
  usd: number;
  action: BudgetAction;
}

export interface BudgetCheckResult {
  allowed: boolean;
  action: BudgetAction | null;
  spent: number;
  limit: number;
  message?: string;
}

/**
 * Check whether a request is within budget limits.
 */
export function checkBudgetLimits(
  spent: number,
  requestEstimateUsd: number,
  limits: { hard?: BudgetLimit; session?: BudgetLimit; daily?: BudgetLimit },
): BudgetCheckResult {
  const projected = spent + requestEstimateUsd;

  if (limits.hard && projected > limits.hard.usd) {
    return {
      allowed: limits.hard.action !== "block",
      action: limits.hard.action,
      spent,
      limit: limits.hard.usd,
      message:
        limits.hard.action === "block"
          ? "budget_exhausted"
          : `Hard budget warning: $${projected.toFixed(4)} > $${limits.hard.usd}`,
    };
  }

  if (limits.session && projected > limits.session.usd) {
    return {
      allowed: limits.session.action !== "block",
      action: limits.session.action,
      spent,
      limit: limits.session.usd,
    };
  }

  if (limits.daily && projected > limits.daily.usd) {
    return {
      allowed: limits.daily.action !== "block",
      action: limits.daily.action,
      spent,
      limit: limits.daily.usd,
    };
  }

  return { allowed: true, action: null, spent, limit: Infinity };
}
