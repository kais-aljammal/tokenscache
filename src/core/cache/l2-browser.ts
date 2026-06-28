import { openDB, type IDBPDatabase } from "idb";
import type { ChatResponse } from "../types.js";

const STORE = "cache_entries";
const META_STORE = "meta";

export interface L2CacheEntry {
  hash: string;
  response: string;
  provider: string;
  model: string;
  createdAt: number;
  lastAccessedAt: number;
  sizeBytes: number;
}

export interface L2BrowserCacheOptions {
  dbName: string;
  maxSizeMB: number;
}

/**
 * Sanitize IndexedDB keys — prevent injection via user-controlled hash strings.
 */
export function sanitizeCacheKey(key: string): string {
  if (!/^[a-f0-9]{64}$/i.test(key)) {
    throw new Error("[TokenGuard] Invalid cache key format");
  }
  return key.toLowerCase();
}

/**
 * L2 browser cache via IndexedDB (idb wrapper).
 */
export class L2BrowserCache {
  private db: IDBPDatabase | null = null;
  private readonly dbName: string;
  private readonly maxSizeBytes: number;
  private totalSizeBytes = 0;

  constructor(options: L2BrowserCacheOptions) {
    this.dbName = options.dbName;
    this.maxSizeBytes = options.maxSizeMB * 1024 * 1024;
  }

  async init(): Promise<void> {
    this.db = await openDB(this.dbName, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "hash" });
          store.createIndex("lastAccessedAt", "lastAccessedAt");
          store.createIndex("createdAt", "createdAt");
        }
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE);
        }
      },
    });

    const meta = await this.db.get(META_STORE, "totalSizeBytes");
    this.totalSizeBytes = (meta as number) ?? 0;
  }

  private requireDb(): IDBPDatabase {
    if (!this.db) throw new Error("[TokenGuard] L2 cache not initialized — call init() first");
    return this.db;
  }

  async get(hash: string): Promise<ChatResponse | undefined> {
    const key = sanitizeCacheKey(hash);
    const db = this.requireDb();
    const entry = (await db.get(STORE, key)) as L2CacheEntry | undefined;
    if (!entry) return undefined;

    entry.lastAccessedAt = Date.now();
    await db.put(STORE, entry);

    const response = JSON.parse(entry.response) as ChatResponse;
    return { ...response, cached: true, cacheLayer: "L2" };
  }

  async set(hash: string, response: ChatResponse, provider: string, model: string): Promise<void> {
    const key = sanitizeCacheKey(hash);
    const db = this.requireDb();
    const serialized = JSON.stringify({ ...response, cached: true, cacheLayer: "L2" });
    const sizeBytes = new TextEncoder().encode(serialized).length;

    const existing = (await db.get(STORE, key)) as L2CacheEntry | undefined;
    if (existing) {
      this.totalSizeBytes -= existing.sizeBytes;
    }

    await this.evictIfNeeded(sizeBytes);

    const now = Date.now();
    const entry: L2CacheEntry = {
      hash: key,
      response: serialized,
      provider,
      model,
      createdAt: existing?.createdAt ?? now,
      lastAccessedAt: now,
      sizeBytes,
    };

    await db.put(STORE, entry);
    this.totalSizeBytes += sizeBytes;
    await db.put(META_STORE, this.totalSizeBytes, "totalSizeBytes");
  }

  async delete(hash: string): Promise<boolean> {
    const key = sanitizeCacheKey(hash);
    const db = this.requireDb();
    const existing = (await db.get(STORE, key)) as L2CacheEntry | undefined;
    if (!existing) return false;
    await db.delete(STORE, key);
    this.totalSizeBytes -= existing.sizeBytes;
    await db.put(META_STORE, this.totalSizeBytes, "totalSizeBytes");
    return true;
  }

  async clear(): Promise<void> {
    const db = this.requireDb();
    await db.clear(STORE);
    this.totalSizeBytes = 0;
    await db.put(META_STORE, 0, "totalSizeBytes");
  }

  async size(): Promise<number> {
    const db = this.requireDb();
    return db.count(STORE);
  }

  private async evictIfNeeded(incomingBytes: number): Promise<void> {
    while (this.totalSizeBytes + incomingBytes > this.maxSizeBytes) {
      const db = this.requireDb();
      const tx = db.transaction(STORE, "readwrite");
      const index = tx.store.index("lastAccessedAt");
      const cursor = await index.openCursor();
      if (!cursor) break;
      const entry = cursor.value as L2CacheEntry;
      this.totalSizeBytes -= entry.sizeBytes;
      await cursor.delete();
      await tx.done;
    }
  }
}
