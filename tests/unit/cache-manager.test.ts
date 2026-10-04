import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CacheManager, FIFOEvictionPolicy, LFUEvictionPolicy, LRUEvictionPolicy } from "../../src/core/cache/cache-manager.js";
import { TokensCache } from "../../src/index.js";
import { openDatabase } from "../../src/core/db/index.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("CacheManager", () => {
  let cache: CacheManager<string>;

  beforeEach(() => {
    cache = new CacheManager({ maxEntries: 3, evictionPolicy: new LRUEvictionPolicy() });
  });

  it("stores and retrieves values", () => {
    cache.set("a", "hello");
    expect(cache.get("a")).toBe("hello");
  });

  it("evicts LRU entries when over capacity", () => {
    let now = 1000;
    const originalNow = Date.now;
    Date.now = () => now++;

    try {
      cache.set("a", "1");
      cache.set("b", "2");
      cache.set("c", "3");
      cache.get("a");
      cache.set("d", "4");
      expect(cache.has("b")).toBe(false);
      expect(cache.has("a")).toBe(true);
    } finally {
      Date.now = originalNow;
    }
  });

  it("expires entries after TTL", () => {
    let now = 1000;
    const originalNow = Date.now;
    Date.now = () => now;

    try {
      const ttlCache = new CacheManager<string>({ maxEntries: 10, defaultTtlMs: 100 });
      ttlCache.set("a", "1");
      ttlCache.set("b", "2", 500);
      expect(ttlCache.get("a")).toBe("1");
      now = 1101;
      expect(ttlCache.get("a")).toBeUndefined();
      expect(ttlCache.has("a")).toBe(false);
      expect(ttlCache.get("b")).toBe("2");
      now = 1600;
      ttlCache.set("c", "3");
      ttlCache.set("d", "4");
      expect(ttlCache.has("c")).toBe(true);
      expect(ttlCache.has("d")).toBe(true);
      expect(ttlCache.size()).toBe(2);
    } finally {
      Date.now = originalNow;
    }
  });

  it("evicts LFU entries when over capacity", () => {
    const lfu = new CacheManager({ maxEntries: 3, evictionPolicy: new LFUEvictionPolicy() });
    lfu.set("a", "1");
    lfu.set("b", "2");
    lfu.set("c", "3");
    lfu.get("a");
    lfu.get("a");
    lfu.get("c");
    lfu.peek("b");
    lfu.peek("b");
    lfu.set("d", "4");
    expect(lfu.has("b")).toBe(false);
    expect(lfu.has("a")).toBe(true);
    expect(lfu.has("c")).toBe(true);
    expect(lfu.has("d")).toBe(true);
  });

  it("tracks hits, misses, evictions, and size", () => {
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");
    expect(cache.get("a")).toBe("1");
    expect(cache.get("missing")).toBeUndefined();
    cache.set("d", "4");
    expect(cache.getStats()).toEqual({ size: 3, hits: 1, misses: 1, evictions: 1 });
  });

  it("updates existing keys in place without extra eviction", () => {
    const fifo = new CacheManager({ maxEntries: 3, evictionPolicy: new FIFOEvictionPolicy() });
    fifo.set("a", "1");
    fifo.set("b", "2");
    fifo.set("c", "3");
    fifo.set("a", "updated");
    expect(fifo.peek("a")).toBe("updated");
    expect(fifo.size()).toBe(3);
    expect(fifo.has("a")).toBe(true);
    expect(fifo.has("b")).toBe(true);
    expect(fifo.has("c")).toBe(true);
    fifo.set("d", "4");
    expect(fifo.has("a")).toBe(false);
    expect(fifo.has("b")).toBe(true);
    expect(fifo.has("c")).toBe(true);
    expect(fifo.has("d")).toBe(true);
  });

  it("sweepExpired removes expired entries", () => {
    let now = 1000;
    const originalNow = Date.now;
    Date.now = () => now;

    try {
      const ttlCache = new CacheManager<string>({ maxEntries: 2, defaultTtlMs: 100 });
      ttlCache.set("live", "1", 5000);
      ttlCache.set("stale", "2", 50);
      now = 1100;
      ttlCache.sweepExpired();
      expect(ttlCache.peek("stale")).toBeUndefined();
      expect(ttlCache.peek("live")).toBe("1");
      expect(ttlCache.size()).toBe(1);
      ttlCache.set("fresh", "3");
      expect(ttlCache.has("live")).toBe(true);
      expect(ttlCache.has("fresh")).toBe(true);
      expect(ttlCache.size()).toBe(2);
    } finally {
      Date.now = originalNow;
    }
  });
});

describe("SQLite schema", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tokenscache-"));
    dbPath = join(dir, "test.db");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("initializes without error", async () => {
    const { adapter, close } = await openDatabase({ dbPath, loadPricing: false });
    const row = adapter.prepare("SELECT version FROM schema_version").get() as { version: number };
    expect(row.version).toBe(1);
    close();
  });
});

describe("TokensCache", () => {
  it("hashes prompts deterministically", () => {
    const messages = [{ role: "user" as const, content: "hello" }];
    const h1 = TokensCache.hashPrompt(messages);
    const h2 = TokensCache.hashPrompt(messages);
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });
});
