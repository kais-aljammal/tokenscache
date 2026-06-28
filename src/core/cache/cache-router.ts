import type { ChatMessage, ChatRequest, ChatResponse } from "../types.js";
import { hashPromptSync } from "./hash.js";
import { L1MemoryCache } from "./l1-memory.js";
import type { L2BrowserCache } from "./l2-browser.js";
import type { L3LocalCache } from "./l3-local.js";
import type { SemanticMatcher } from "./semantic-match.js";

export interface CacheRouterOptions {
  l1MaxEntries: number;
  l1TtlMs?: number;
  /** Reuse cached responses for the same metadata.artifact (agent codegen). */
  agentArtifactScope?: boolean;
}

const ARTIFACT_SCOPE_PREFIX = "artifact:";

function artifactScopeKey(request: ChatRequest): string | null {
  const artifact = request.metadata?.artifact;
  if (typeof artifact !== "string" || artifact.length === 0) return null;
  return `${ARTIFACT_SCOPE_PREFIX}${artifact}`;
}

export interface CacheLookupResult {
  hit: boolean;
  response?: ChatResponse;
  layer?: "L1" | "L2" | "L3" | "semantic" | "artifact";
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
  private readonly hashToArtifactKey = new Map<string, string>();

  constructor(options: CacheRouterOptions, deps: CacheRouterDeps = {}) {
    this.l1 = new L1MemoryCache({ maxEntries: options.l1MaxEntries, defaultTtlMs: options.l1TtlMs });
    this.l2 = deps.l2;
    this.l3 = deps.l3;
    this.semantic = deps.semantic;
    this.agentArtifactScope = options.agentArtifactScope ?? false;
  }

  hashMessages(messages: ChatMessage[]): string {
    return hashPromptSync(messages);
  }

  async lookup(request: ChatRequest): Promise<CacheLookupResult> {
    const hash = this.hashMessages(request.messages);

    const l1Hit = this.l1.get(hash);
    if (l1Hit) {
      return { hit: true, response: l1Hit, layer: "L1", hash };
    }

    if (this.agentArtifactScope) {
      const scopeKey = artifactScopeKey(request);
      if (scopeKey) {
        const scopedHit = this.l1.get(scopeKey);
        if (scopedHit) {
          return {
            hit: true,
            response: { ...scopedHit, cached: true, cacheLayer: "artifact" },
            layer: "artifact",
            hash,
          };
        }
      }
    }

    if (this.l2) {
      const l2Hit = await this.l2.get(hash);
      if (l2Hit) {
        this.l1.set(hash, l2Hit);
        return { hit: true, response: l2Hit, layer: "L2", hash };
      }
    }

    if (this.l3) {
      const l3Hit = await this.l3.getByHash(hash);
      if (l3Hit) {
        this.l1.set(hash, l3Hit);
        if (this.l2) await this.l2.set(hash, l3Hit, request.provider, request.model);
        return { hit: true, response: l3Hit, layer: "L3", hash };
      }
    }

    if (this.semantic) {
      const semanticHit = await this.semantic.findSimilar(request);
      if (semanticHit) {
        this.l1.set(hash, semanticHit.response);
        if (this.l2) await this.l2.set(hash, semanticHit.response, request.provider, request.model);
        if (this.l3) await this.l3.set(hash, request, semanticHit.response);
        return { hit: true, response: semanticHit.response, layer: "semantic", hash };
      }
    }

    return { hit: false, hash };
  }

  async store(request: ChatRequest, response: ChatResponse): Promise<void> {
    const hash = this.hashMessages(request.messages);
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
    if (hash) {
      const scopeKey = this.hashToArtifactKey.get(hash);
      if (scopeKey) {
        this.l1.delete(scopeKey);
        this.hashToArtifactKey.delete(hash);
      }
      this.l1.delete(hash);
      if (this.l2) await this.l2.delete(hash);
      if (this.l3) await this.l3.delete(hash);
    } else {
      this.hashToArtifactKey.clear();
      this.l1.clear();
      if (this.l2) await this.l2.clear();
      if (this.l3) await this.l3.clear();
    }
  }

  getStats(): { l1Size: number } {
    return { l1Size: this.l1.size() };
  }
}
