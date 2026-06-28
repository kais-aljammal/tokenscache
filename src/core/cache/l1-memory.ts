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

/**
 * L1 in-memory LRU cache — sub-1ms lookups for current session.
 */
export class L1MemoryCache {
  private readonly cache: CacheManager<string>;

  constructor(options: L1CacheOptions) {
    this.cache = new CacheManager({
      maxEntries: options.maxEntries,
      evictionPolicy: new LRUEvictionPolicy(),
      defaultTtlMs: options.defaultTtlMs,
    });
  }

  get(hash: string): ChatResponse | undefined {
    const raw = this.cache.get(hash);
    if (!raw) return undefined;
    return JSON.parse(raw) as ChatResponse;
  }

  set(hash: string, response: ChatResponse, ttlMs?: number): void {
    this.cache.set(hash, JSON.stringify({ ...response, cached: true, cacheLayer: "L1" }), ttlMs);
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
}

export { CacheManager, LRUEvictionPolicy } from "./cache-manager.js";
