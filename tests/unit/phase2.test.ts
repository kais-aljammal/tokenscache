import { describe, it, expect, beforeEach } from "vitest";
import { hashPromptSync, normalizeMessages, serializePrompt } from "../../src/core/cache/hash.js";
import { L1MemoryCache } from "../../src/core/cache/l1-memory.js";
import { sanitizeCacheKey } from "../../src/core/cache/l2-browser.js";
import { CacheRouter } from "../../src/core/cache/cache-router.js";
import type { ChatResponse } from "../../src/core/types.js";

const mockResponse = (content: string): ChatResponse => ({
  id: "test-id",
  content,
  model: "test-model",
  usage: { inputTokens: 10, outputTokens: 5 },
  cached: false,
});

describe("hash", () => {
  it("normalizes whitespace in messages", () => {
    const msgs = [{ role: "user" as const, content: "  hello   world  " }];
    expect(normalizeMessages(msgs)[0].content).toBe("hello world");
  });

  it("produces deterministic SHA-256 hashes", () => {
    const msgs = [{ role: "user" as const, content: "test" }];
    expect(hashPromptSync(msgs)).toBe(hashPromptSync(msgs));
    expect(hashPromptSync(msgs)).toHaveLength(64);
  });

  it("different prompts produce different hashes", () => {
    const a = [{ role: "user" as const, content: "a" }];
    const b = [{ role: "user" as const, content: "b" }];
    expect(hashPromptSync(a)).not.toBe(hashPromptSync(b));
  });
});

describe("L1MemoryCache", () => {
  let cache: L1MemoryCache;

  beforeEach(() => {
    cache = new L1MemoryCache({ maxEntries: 100 });
  });

  it("stores and retrieves responses", () => {
    const hash = hashPromptSync([{ role: "user", content: "hi" }]);
    cache.set(hash, mockResponse("hello"));
    expect(cache.get(hash)?.content).toBe("hello");
    expect(cache.get(hash)?.cacheLayer).toBe("L1");
  });
});

describe("sanitizeCacheKey", () => {
  it("accepts valid SHA-256 hex keys", () => {
    const key = "a".repeat(64);
    expect(sanitizeCacheKey(key)).toBe(key);
  });

  it("rejects invalid keys (XSS/injection prevention)", () => {
    expect(() => sanitizeCacheKey("<script>alert(1)</script>")).toThrow("Invalid cache key");
    expect(() => sanitizeCacheKey("not-a-hash")).toThrow("Invalid cache key");
  });
});

describe("CacheRouter", () => {
  it("returns L1 hit without provider call", async () => {
    const router = new CacheRouter({ l1MaxEntries: 100 });
    const request = {
      provider: "openai",
      model: "gpt-test",
      messages: [{ role: "user" as const, content: "hello" }],
    };
    const response = mockResponse("world");
    await router.store(request, response);

    const result = await router.lookup(request);
    expect(result.hit).toBe(true);
    expect(result.layer).toBe("L1");
    expect(result.response?.content).toBe("world");
  });

  it("returns miss for unknown prompt", async () => {
    const router = new CacheRouter({ l1MaxEntries: 100 });
    const result = await router.lookup({
      provider: "openai",
      model: "gpt-test",
      messages: [{ role: "user" as const, content: "unknown" }],
    });
    expect(result.hit).toBe(false);
  });

  it("hits artifact-scoped cache for paraphrased agent prompts", async () => {
    const router = new CacheRouter({ l1MaxEntries: 100, agentArtifactScope: true });
    const first = {
      provider: "openai",
      model: "gpt-test",
      messages: [{ role: "user" as const, content: "Create a Cart class with add and remove." }],
      metadata: { artifact: "cart" },
    };
    const paraphrase = {
      ...first,
      messages: [{ role: "user" as const, content: "Build a shopping cart supporting add/remove." }],
    };

    await router.store(first, mockResponse("export class Cart {}"));

    const result = await router.lookup(paraphrase);
    expect(result.hit).toBe(true);
    expect(result.layer).toBe("artifact");
    expect(result.response?.content).toBe("export class Cart {}");
  });
});
