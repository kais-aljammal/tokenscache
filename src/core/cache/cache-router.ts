import type { ChatMessage, ChatRequest, ChatResponse } from "../types.js";
import { hashCacheKey, hashPromptSync } from "./hash.js";
import { L1MemoryCache } from "./l1-memory.js";
import type { L2BrowserCache } from "./l2-browser.js";
import type { L3LocalCache } from "./l3-local.js";
import type { SemanticMatcher } from "./semantic-match.js";

export interface CacheRouterOptions {
  l1MaxEntries: number;
  l1TtlMs?: number;
  /** Reuse cached responses for the same metadata.artifact (agent codegen). */
  agentArtifactScope?: boolean;
  /** Default true — isolate cache entries by model. */
  includeModelInKey?: boolean;
  /** Default true — isolate cache entries by tools. */
  includeToolsInKey?: boolean;
}

export type CacheLayer = "L1" | "L2" | "L3" | "semantic" | "artifact";

export interface CacheRouterStats {
  l1Size: number;
  hits: Record<CacheLayer, number>;
  misses: number;
  inflightCoalesced: number;
}

const ARTIFACT_SCOPE_PREFIX = "artifact:";

function artifactScopeKey(request: ChatRequest): string | null {
  const artifact = request.metadata?.artifact;
  if (typeof artifact !== "string" || artifact.length === 0) return null;
  return `${ARTIFACT_SCOPE_PREFIX}${artifact}`;
}

type SemanticInvalidator = {
  clear?: () => void | Promise<void>;
  delete?: (hash: string) => unknown | Promise<unknown>;
};

export interface CacheLookupResult {
  hit: boolean;
  response?: ChatResponse;
  layer?: CacheLayer;
  hash: string;
}

export interface CacheRouterDeps {
  l2?: L2BrowserCache;
  l3?: L3LocalCache;
  semantic?: SemanticMatcher;
}

/**
 * Orchestrates L1 → L2 → L3 → semantic cache lookup with promotion.
 */
export class CacheRouter {
  private readonly l1: L1MemoryCache;
  private readonly l2?: L2BrowserCache;
  private readonly l3?: L3LocalCache;
  private readonly semantic?: SemanticMatcher;
  private readonly agentArtifactScope: boolean;
  private readonly includeModelInKey: boolean;
  private readonly includeToolsInKey: boolean;
  private readonly hashToArtifactKey = new Map<string, string>();
  private readonly inflight = new Map<string, Promise<CacheLookupResult>>();
  private readonly coalesced = new Map<string, Promise<unknown>>();
  private readonly hits: Record<CacheLayer, number> = {
    L1: 0,
    L2: 0,
    L3: 0,
    semantic: 0,
    artifact: 0,
  };
  private misses = 0;
  private inflightCoalesced = 0;

  constructor(options: CacheRouterOptions, deps: CacheRouterDeps = {}) {
    this.l1 = new L1MemoryCache({ maxEntries: options.l1MaxEntries, defaultTtlMs: options.l1TtlMs });
    this.l2 = deps.l2;
    this.l3 = deps.l3;
    this.semantic = deps.semantic;
    this.agentArtifactScope = options.agentArtifactScope ?? false;
    this.includeModelInKey = options.includeModelInKey ?? true;
    this.includeToolsInKey = options.includeToolsInKey ?? true;
  }

  hashMessages(messages: ChatMessage[]): string {
    return hashPromptSync(messages);
  }

  hashRequest(request: ChatRequest): string {
    return hashCacheKey({
      messages: request.messages,
      provider: request.provider,
      model: request.model,
      tools: request.tools,
      includeModel: this.includeModelInKey,
      includeTools: this.includeToolsInKey,
    });
  }

  async lookup(request: ChatRequest): Promise<CacheLookupResult> {
    const hash = this.hashRequest(request);
    const existing = this.inflight.get(hash);
    if (existing) {
      this.inflightCoalesced += 1;
      return existing;
    }

    const pending = this.performLookup(request, hash).finally(() => {
      this.inflight.delete(hash);
    });
    this.inflight.set(hash, pending);
    return pending;
  }

  /**
   * Join in-flight work for the same hash (provider-call stampede protection).
   */
  async runCoalesced<T>(hash: string, work: () => Promise<T>): Promise<T> {
    const existing = this.coalesced.get(hash);
    if (existing) {
      this.inflightCoalesced += 1;
      return existing as Promise<T>;
    }

    const pending = Promise.resolve()
      .then(work)
      .finally(() => {
        this.coalesced.delete(hash);
      });
    this.coalesced.set(hash, pending);
    return pending as Promise<T>;
  }

  async store(request: ChatRequest, response: ChatResponse): Promise<void> {
    const hash = this.hashRequest(request);
    this.l1.set(hash, response);
    if (this.agentArtifactScope) {
      const scopeKey = artifactScopeKey(request);
      if (scopeKey) {
        this.l1.set(scopeKey, response);
        this.hashToArtifactKey.set(hash, scopeKey);
      }
    }
    if (this.l2) await this.l2.set(hash, response, request.provider, request.model);
    if (this.l3) await this.l3.set(hash, request, response);
    if (this.semantic) await this.semantic.index(request, response, hash);
  }

  async invalidate(hash?: string): Promise<void> {
    const semantic = this.semantic as SemanticInvalidator | undefined;
    if (hash) {
      const scopeKey = this.hashToArtifactKey.get(hash);
      if (scopeKey) {
        this.l1.delete(scopeKey);
        this.hashToArtifactKey.delete(hash);
      }
      this.l1.delete(hash);
      if (this.l2) await this.l2.delete(hash);
      if (this.l3) await this.l3.delete(hash);
      if (typeof semantic?.delete === "function") {
        await semantic.delete(hash);
      }
    } else {
      this.hashToArtifactKey.clear();
      this.l1.clear();
      if (this.l2) await this.l2.clear();
      if (this.l3) await this.l3.clear();
      if (typeof semantic?.clear === "function") {
        await semantic.clear();
      }
    }
  }

  getStats(): CacheRouterStats {
    return {
      l1Size: this.l1.size(),
      hits: { ...this.hits },
      misses: this.misses,
      inflightCoalesced: this.inflightCoalesced,
    };
  }

  private async performLookup(request: ChatRequest, hash: string): Promise<CacheLookupResult> {
    const l1Hit = this.l1.get(hash);
    if (l1Hit) {
      return this.recordHit({ hit: true, response: l1Hit, layer: "L1", hash });
    }

    if (this.agentArtifactScope) {
      const scopeKey = artifactScopeKey(request);
      if (scopeKey) {
        const scopedHit = this.l1.get(scopeKey);
        if (scopedHit) {
          return this.recordHit({
            hit: true,
            response: { ...scopedHit, cached: true, cacheLayer: "artifact" },
            layer: "artifact",
            hash,
          });
        }
      }
    }

    if (this.l2) {
      const l2Hit = await this.l2.get(hash, { provider: request.provider, model: request.model });
      if (l2Hit) {
        this.l1.set(hash, l2Hit);
        return this.recordHit({ hit: true, response: l2Hit, layer: "L2", hash });
      }
    }

    if (this.l3) {
      const l3Hit = await this.l3.getByHash(hash, {
        provider: request.provider,
        model: request.model,
      });
      if (l3Hit) {
        this.l1.set(hash, l3Hit);
        if (this.l2) await this.l2.set(hash, l3Hit, request.provider, request.model);
        return this.recordHit({ hit: true, response: l3Hit, layer: "L3", hash });
      }
    }

    if (this.semantic) {
      const semanticHit = await this.semantic.findSimilar(request);
      if (semanticHit) {
        this.l1.set(hash, semanticHit.response);
        if (this.l2) await this.l2.set(hash, semanticHit.response, request.provider, request.model);
        if (this.l3) await this.l3.set(hash, request, semanticHit.response);
        return this.recordHit({ hit: true, response: semanticHit.response, layer: "semantic", hash });
      }
    }

    this.misses += 1;
    return { hit: false, hash };
  }

  private recordHit(result: CacheLookupResult & { layer: CacheLayer }): CacheLookupResult {
    this.hits[result.layer] += 1;
    return result;
  }
}
