import { isAllowedUpstreamUrl } from "./core/providers/whitelist.js";
import { hashPromptSync } from "./core/cache/hash.js";
import type {
  BudgetStatus,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  TokenGuardConfig,
} from "./core/types.js";
import { TokenGuardConfigSchema } from "./core/types.js";
import { CacheRouter } from "./core/cache/cache-router.js";
import { HashEmbeddingService } from "./core/cache/embedding.js";
import { L3LocalCache } from "./core/cache/l3-local.js";
import { SemanticMatcher } from "./core/cache/semantic-match.js";
import { BudgetEnforcer } from "./core/budget/enforcer.js";
import { BudgetLedger } from "./core/budget/ledger.js";
import { openDatabase, type TokenGuardDatabase } from "./core/db/index.js";
import {
  alignForProviderCache,
  compressHistory,
  pruneTools,
  shapeOutput,
} from "./core/optimizer/index.js";
import type { ProviderAdapter } from "./core/providers/base.js";

export interface TokenGuardOptions {
  config: TokenGuardConfig;
  sessionId?: string;
  dbPath?: string;
}

/**
 * TokenGuard SDK — middleware for semantic caching, compression, and budget enforcement.
 */
export class TokenGuard {
  readonly config: TokenGuardConfig;
  private readonly sessionId: string;
  private database: TokenGuardDatabase | null;
  private ledger: BudgetLedger | null;
  private cacheRouter: CacheRouter | null = null;
  private budgetEnforcer: BudgetEnforcer | null = null;
  private readonly providers = new Map<string, ProviderAdapter>();
  private _cacheHits = 0;
  private _cacheMisses = 0;

  constructor(options: TokenGuardOptions) {
    this.config = TokenGuardConfigSchema.parse(options.config);
    this.sessionId = options.sessionId ?? crypto.randomUUID();
    this.database = null;
    this.ledger = null;
    this._dbPath = options.dbPath ?? this.config.cache?.l3?.dbPath ?? ":memory:";
  }

  private readonly _dbPath: string;
  private _initialized = false;

  /**
   * Initialize async database layer (sql.js). Call before chat() if ledger persistence is needed.
   */
  async init(): Promise<void> {
    if (this._initialized) return;

    const l1Max = this.config.cache?.l1?.maxEntries ?? 500;
    const agentArtifactScope = this.config.cache?.agentArtifactScope ?? false;

    try {
      this.database = await openDatabase({ dbPath: this._dbPath });
      this.ledger = new BudgetLedger(this.database.adapter);
      this.ledger.ensureSession(this.sessionId);

      const l3 = new L3LocalCache({
        adapter: this.database.adapter,
        embeddingProvider: new HashEmbeddingService(64),
      });
      await l3.init();

      const semanticConfig = this.config.cache?.semantic;
      const semantic = semanticConfig
        ? new SemanticMatcher({
            highThreshold: semanticConfig.highThreshold,
            grayZoneMin: semanticConfig.grayZoneMin,
            matchPolicy: semanticConfig.matchPolicy,
            embeddingProvider: new HashEmbeddingService(64),
          })
        : undefined;

      this.cacheRouter = new CacheRouter(
        { l1MaxEntries: l1Max, agentArtifactScope },
        { l3, semantic },
      );
      this.budgetEnforcer = new BudgetEnforcer({
        adapter: this.database.adapter,
        config: this.config,
        sessionId: this.sessionId,
      });
    } catch {
      this.database = null;
      this.ledger = null;
      this.cacheRouter = new CacheRouter({ l1MaxEntries: l1Max, agentArtifactScope });
      this.budgetEnforcer = null;
    }

    this._initialized = true;
  }

  /**
   * Register a provider adapter instance.
   */
  registerProvider(adapter: ProviderAdapter): void {
    const baseUrl = adapter.getBaseUrl();
    if (baseUrl && !isAllowedUpstreamUrl(baseUrl)) {
      throw new Error(`[TokenGuard] Provider baseUrl not whitelisted: ${baseUrl}`);
    }
    this.providers.set(adapter.name, adapter);
  }

  /**
   * Normalize and hash a prompt for exact-match cache lookup.
   */
  static hashPrompt(messages: ChatMessage[]): string {
    return hashPromptSync(messages);
  }

  /**
   * Process a chat request through cache → optimizer → provider pipeline.
   */
  async chat(request: ChatRequest): Promise<ChatResponse> {
    await this.init();
    const router = this.cacheRouter!;

    const cacheResult = await router.lookup(request);
    if (cacheResult.hit && cacheResult.response) {
      this._cacheHits++;
      return {
        ...cacheResult.response,
        cached: true,
        cacheLayer: cacheResult.layer,
      };
    }
    this._cacheMisses++;

    let processed: ChatRequest = { ...request };

    if (this.budgetEnforcer) {
      const budgetCheck = this.budgetEnforcer.check(processed);
      processed = this.budgetEnforcer.applyAction(processed, budgetCheck.action);
    }

    const opt = this.config.optimizer;

    if (opt?.toolPruning !== false && processed.tools) {
      processed = {
        ...processed,
        tools: pruneTools(processed.tools, processed.messages),
      };
    }

    if (opt?.historyCompression !== false) {
      processed = {
        ...processed,
        messages: await compressHistory(processed.messages, {
          compressionTrigger: opt?.compressionTrigger,
        }),
      };
    }

    if (opt?.outputShaping !== false) {
      processed = {
        ...processed,
        messages: shapeOutput(processed.messages, {
          triggerRatio: opt?.outputShapingTrigger,
          holdoutRatio: opt?.outputShapingHoldout,
        }),
      };
    }

    if (opt?.cacheAlignment !== false) {
      const alignment = alignForProviderCache(
        processed.messages,
        {},
        {
          provider: processed.provider,
          model: processed.model,
        },
      );
      processed = {
        ...processed,
        metadata: {
          ...processed.metadata,
          cacheAlignment: alignment,
        },
      };
    }

    const adapter = this.providers.get(processed.provider);
    if (!adapter) {
      throw new Error(`[TokenGuard] No provider registered: ${processed.provider}`);
    }

    const response = await adapter.chat(processed);
    const enriched: ChatResponse = {
      ...response,
      cached: false,
      metadata: {
        ...response.metadata,
        ...processed.metadata,
      },
    };

    await router.store(request, enriched);

    if (this.budgetEnforcer) {
      const includeCacheStorage = this.config.budget?.includeCacheStorageHoldingCosts ?? true;
      this.budgetEnforcer.record(processed, response.usage, response.id, includeCacheStorage);
      this.database?.persist();
    }

    return enriched;
  }

  getCacheStats(): {
    l1Size: number;
    sessionId: string;
    hits: number;
    misses: number;
  } {
    return {
      l1Size: this.cacheRouter?.getStats().l1Size ?? 0,
      sessionId: this.sessionId,
      hits: this._cacheHits,
      misses: this._cacheMisses,
    };
  }

  async invalidateCache(hash?: string): Promise<void> {
    await this.init();
    await this.cacheRouter?.invalidate(hash);
  }

  getBudgetStatus(): BudgetStatus {
    if (!this.budgetEnforcer) {
      return { spentUsd: 0, limitUsd: Infinity, action: null };
    }

    const status = this.budgetEnforcer.getStatus();

    return {
      spentUsd: status.spent,
      limitUsd: status.limit,
      action: status.action,
    };
  }

  async compressContext(messages: ChatMessage[]): Promise<ChatMessage[]> {
    return compressHistory(messages, {
      compressionTrigger: this.config.optimizer?.compressionTrigger ?? 0.6,
    });
  }

  getAuditLog(limit = 50): Array<Record<string, unknown>> {
    if (!this.database) return [];

    return this.database.adapter
      .prepare(
        `SELECT id, session_id, provider, model, input_tokens, output_tokens,
                cache_read_tokens, cache_write_tokens, cost_usd, created_at
         FROM ledger_entries
         WHERE session_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(this.sessionId, limit) as Array<Record<string, unknown>>;
  }

  close(): void {
    this.database?.close();
  }
}

export { TokenGuardConfigSchema };
export type { TokenGuardConfig, ChatRequest, ChatResponse, ChatMessage } from "./core/types.js";
export { CacheManager, LRUEvictionPolicy, FIFOEvictionPolicy } from "./core/cache/cache-manager.js";
export { ProviderAdapter } from "./core/providers/base.js";
export { BudgetLedger, checkBudgetLimits } from "./core/budget/ledger.js";
export { BudgetEnforcer } from "./core/budget/enforcer.js";
export { ModelRouter } from "./core/budget/router.js";
export {
  loadPricingConfig,
  estimateUsageCost,
  estimateRequestCost,
  resolveModelTier,
} from "./core/budget/pricing.js";
export { openDatabase, initializeSchema } from "./core/db/index.js";
export { SemanticMatcher } from "./core/cache/semantic-match.js";
export { L3LocalCache } from "./core/cache/l3-local.js";
export { CacheRouter } from "./core/cache/cache-router.js";
export {
  LocalEmbeddingService,
  HashEmbeddingService,
  cosineSimilarity,
  embeddingToBlob,
  blobToEmbedding,
} from "./core/cache/embedding.js";
export {
  StaticThresholdPolicy,
  VerifiedDecisionPolicy,
} from "./core/cache/match-policy/index.js";
export {
  pruneTools,
  routeContent,
  compressHistory,
  shapeOutput,
  alignForProviderCache,
} from "./core/optimizer/index.js";
export { AnthropicProvider, OpenAIProvider, GeminiProvider } from "./core/providers/index.js";
