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
}

export interface EvictionPolicy<T = unknown> {
  /** Select keys to evict when over capacity. */
  selectForEviction(entries: CacheEntry<T>[], count: number): string[];
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

  constructor(options: CacheManagerOptions<T>) {
    this.maxEntries = options.maxEntries;
    this.evictionPolicy = options.evictionPolicy ?? new LRUEvictionPolicy<T>();
    this.defaultTtlMs = options.defaultTtlMs;
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    if (this.isExpired(entry)) {
      this.store.delete(key);
      return undefined;
    }

    entry.lastAccessedAt = Date.now();
    entry.hitCount += 1;
    return entry.value;
  }

  set(key: string, value: T, ttlMs?: number): void {
    const now = Date.now();
    const entry: CacheEntry<T> = {
      key,
      value,
      createdAt: now,
      lastAccessedAt: now,
      hitCount: 0,
    };

    if (ttlMs ?? this.defaultTtlMs) {
      (entry as CacheEntry<T> & { expiresAt: number }).expiresAt = now + (ttlMs ?? this.defaultTtlMs!);
    }

    this.store.set(key, entry);
    this.evictIfNeeded();
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  has(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (this.isExpired(entry)) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  size(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  private evictIfNeeded(): void {
    if (this.store.size <= this.maxEntries) return;
    const overflow = this.store.size - this.maxEntries;
    const entries = Array.from(this.store.values());
    const toEvict = this.evictionPolicy.selectForEviction(entries, overflow);
    for (const key of toEvict) {
      this.store.delete(key);
    }
  }

  private isExpired(entry: CacheEntry<T>): boolean {
    const exp = (entry as CacheEntry<T> & { expiresAt?: number }).expiresAt;
    return exp !== undefined && Date.now() > exp;
  }
}
