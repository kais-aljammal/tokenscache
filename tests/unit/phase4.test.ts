import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDatabase } from "../../src/core/db/index.js";
import { L3LocalCache } from "../../src/core/cache/l3-local.js";
import { HashEmbeddingService } from "../../src/core/cache/embedding.js";
import { hashPromptSync } from "../../src/core/cache/hash.js";
import type { ChatRequest, ChatResponse } from "../../src/core/types.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Phase 4 — L3 local cache", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tokenguard-l3-"));
    dbPath = join(dir, "l3.db");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const request: ChatRequest = {
    provider: "openai",
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: "hello l3 cache" }],
  };

  const response: ChatResponse = {
    id: "resp-1",
    content: "cached response",
    model: "gpt-4o-mini",
    usage: { inputTokens: 5, outputTokens: 3 },
    cached: false,
  };

  it("stores and retrieves by hash with embedding BLOB", async () => {
    const { adapter, close } = await openDatabase({ dbPath, loadPricing: false });
    const cache = new L3LocalCache({
      adapter,
      embeddingProvider: new HashEmbeddingService(32),
      maxEntries: 100,
    });
    await cache.init();

    const hash = hashPromptSync(request.messages);
    await cache.set(hash, request, response);

    const hit = await cache.getByHash(hash);
    expect(hit?.content).toBe("cached response");
    expect(hit?.cacheLayer).toBe("L3");

    const row = adapter
      .prepare(`SELECT embedding FROM cache_entries WHERE prompt_hash = ?`)
      .get(hash) as { embedding: Uint8Array };
    expect(row.embedding).toBeInstanceOf(Uint8Array);
    expect(row.embedding.byteLength).toBeGreaterThan(0);

    close();
  });

  it("searches similar entries via ANN fallback", async () => {
    const { adapter, close } = await openDatabase({ dbPath: ":memory:", loadPricing: false });
    const cache = new L3LocalCache({
      adapter,
      embeddingProvider: new HashEmbeddingService(32),
    });
    await cache.init();

    const hash = hashPromptSync(request.messages);
    await cache.set(hash, request, response);

    const similar = await cache.searchSimilar({
      ...request,
      messages: [{ role: "user", content: "hello l3 cache!" }],
    });

    expect(similar.length).toBeGreaterThan(0);
    expect(similar[0]?.hash).toBe(hash);

    close();
  });

  it("evicts oldest entries when over maxEntries", async () => {
    const { adapter, close } = await openDatabase({ dbPath: ":memory:", loadPricing: false });
    const cache = new L3LocalCache({
      adapter,
      embeddingProvider: new HashEmbeddingService(16),
      maxEntries: 2,
    });
    await cache.init();

    for (let i = 0; i < 3; i++) {
      const req: ChatRequest = {
        ...request,
        messages: [{ role: "user", content: `message ${i}` }],
      };
      const hash = hashPromptSync(req.messages);
      await cache.set(hash, req, { ...response, content: `resp-${i}` });
    }

    expect(await cache.size()).toBe(2);
    close();
  });
});
