import { CacheManager, LRUEvictionPolicy } from "./cache-manager.js";
import type { ChatResponse } from "../types.js";

export interface L1CacheOptions {
  maxEntries: number;
  defaultTtlMs?: number;
}

export interface L1CacheEntry {
  hash: string;
  response: ChatResponse;
}

export interface L1CacheStats {
  size: number;
  hits: number;
  misses: number;
  evictions: number;
}

/**
 * L1 in-memory LRU cache — sub-1ms lookups for current session.
 */
export class L1MemoryCache {
  private readonly cache: CacheManager<ChatResponse>;

  constructor(options: L1CacheOptions) {
    this.cache = new CacheManager<ChatResponse>({
      maxEntries: options.maxEntries,
      evictionPolicy: new LRUEvictionPolicy<ChatResponse>(),
      defaultTtlMs: options.defaultTtlMs,
    });
  }

  get(hash: string): ChatResponse | undefined {
    const response = this.cache.get(hash);
    if (!response) return undefined;
    return { ...response };
  }

  set(hash: string, response: ChatResponse, ttlMs?: number): void {
    this.cache.set(hash, { ...response, cached: true, cacheLayer: "L1" }, ttlMs);
  }

  delete(hash: string): boolean {
    return this.cache.delete(hash);
  }

  has(hash: string): boolean {
    return this.cache.has(hash);
  }

  size(): number {
    return this.cache.size();
  }

  clear(): void {
    this.cache.clear();
  }

  getStats(): L1CacheStats {
    const manager = this.cache as CacheManager<ChatResponse> & {
      getStats?: () => L1CacheStats;
    };
    if (typeof manager.getStats === "function") {
      return manager.getStats();
    }
    return { size: this.cache.size(), hits: 0, misses: 0, evictions: 0 };
  }
}

export { CacheManager, LRUEvictionPolicy } from "./cache-manager.js";
