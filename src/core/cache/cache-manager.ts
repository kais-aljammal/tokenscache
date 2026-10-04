/**
 * Cache manager abstractions inspired by GPTCache (MIT).
 * Eviction policies and cache data layer — reimplemented in TypeScript.
 */

export interface CacheEntry<T = string> {
  key: string;
  value: T;
  createdAt: number;
  lastAccessedAt: number;
  hitCount: number;
  sizeBytes?: number;
  expiresAt?: number;
}

export interface EvictionPolicy<T = unknown> {
  /** Select keys to evict when over capacity. */
  selectForEviction(entries: CacheEntry<T>[], count: number): string[];
}

export interface CacheStats {
  size: number;
  hits: number;
  misses: number;
  evictions: number;
}

/**
 * Least-recently-used eviction — mirrors GPTCache LRU eviction policy pattern.
 */
export class LRUEvictionPolicy<T = unknown> implements EvictionPolicy<T> {
  selectForEviction(entries: CacheEntry<T>[], count: number): string[] {
    return [...entries]
      .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt || a.createdAt - b.createdAt)
      .slice(0, count)
      .map((e) => e.key);
  }
}

/**
 * FIFO eviction — alternative policy from GPTCache eviction family.
 */
export class FIFOEvictionPolicy<T = unknown> implements EvictionPolicy<T> {
  selectForEviction(entries: CacheEntry<T>[], count: number): string[] {
    return [...entries]
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, count)
      .map((e) => e.key);
  }
}

/**
 * Least-frequently-used eviction — lowest hitCount, then oldest lastAccessedAt.
 */
export class LFUEvictionPolicy<T = unknown> implements EvictionPolicy<T> {
  selectForEviction(entries: CacheEntry<T>[], count: number): string[] {
    return [...entries]
      .sort((a, b) => a.hitCount - b.hitCount || a.lastAccessedAt - b.lastAccessedAt)
      .slice(0, count)
      .map((e) => e.key);
  }
}

export interface CacheManagerOptions<T = unknown> {
  maxEntries: number;
  evictionPolicy?: EvictionPolicy<T>;
  defaultTtlMs?: number;
}

/**
 * In-memory cache manager with pluggable eviction — GPTCache CacheManager abstraction.
 */
export class CacheManager<T = string> {
  private readonly store = new Map<string, CacheEntry<T>>();
  private readonly maxEntries: number;
  private readonly evictionPolicy: EvictionPolicy<T>;
  private readonly defaultTtlMs?: number;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(options: CacheManagerOptions<T>) {
    this.maxEntries = options.maxEntries;
    this.evictionPolicy = options.evictionPolicy ?? new LRUEvictionPolicy<T>();
    this.defaultTtlMs = options.defaultTtlMs;
  }

  get(key: string): T | undefined {
    this.sweepExpired();
    const entry = this.store.get(key);
    if (!entry) {
      this.misses += 1;
      return undefined;
    }

    entry.lastAccessedAt = Date.now();
    entry.hitCount += 1;
    this.hits += 1;
    return entry.value;
  }

  peek(key: string): T | undefined {
    this.sweepExpired();
    return this.store.get(key)?.value;
  }

  set(key: string, value: T, ttlMs?: number): void {
    const now = Date.now();
    const ttl = ttlMs ?? this.defaultTtlMs;
    const existing = this.store.get(key);

    if (existing) {
      existing.value = value;
      existing.lastAccessedAt = now;
      if (ttl) {
        existing.expiresAt = now + ttl;
      } else {
        delete existing.expiresAt;
      }
    } else {
      const entry: CacheEntry<T> = {
        key,
        value,
        createdAt: now,
        lastAccessedAt: now,
        hitCount: 0,
      };
      if (ttl) {
        entry.expiresAt = now + ttl;
      }
      this.store.set(key, entry);
    }

    this.evictIfNeeded();
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  has(key: string): boolean {
    this.sweepExpired();
    return this.store.has(key);
  }

  size(): number {
    this.sweepExpired();
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getStats(): CacheStats {
    return {
      size: this.size(),
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
    };
  }

  sweepExpired(): void {
    let now: number | undefined;
    for (const [key, entry] of this.store) {
      if (entry.expiresAt === undefined) continue;
      now ??= Date.now();
      if (now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }

  private evictIfNeeded(): void {
    this.sweepExpired();
    if (this.store.size <= this.maxEntries) return;
    const overflow = this.store.size - this.maxEntries;
    const entries = Array.from(this.store.values());
    const toEvict = this.evictionPolicy.selectForEviction(entries, overflow);
    for (const key of toEvict) {
      if (this.store.delete(key)) {
        this.evictions += 1;
      }
    }
  }
}
