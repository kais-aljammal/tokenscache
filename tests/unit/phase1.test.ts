import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CacheManager, LRUEvictionPolicy } from "../../src/core/cache/cache-manager.js";
import { TokenGuard } from "../../src/index.js";
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
});

describe("SQLite schema", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tokenguard-"));
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

describe("TokenGuard", () => {
  it("hashes prompts deterministically", () => {
    const messages = [{ role: "user" as const, content: "hello" }];
    const h1 = TokenGuard.hashPrompt(messages);
    const h2 = TokenGuard.hashPrompt(messages);
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });
});
