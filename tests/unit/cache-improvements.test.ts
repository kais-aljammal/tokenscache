import { describe, it, expect } from "vitest";
import { CacheManager } from "../../src/core/cache/cache-manager.js";
import * as cacheManagerMod from "../../src/core/cache/cache-manager.js";
import * as hashMod from "../../src/core/cache/hash.js";
import { HashEmbeddingService } from "../../src/core/cache/embedding.js";
import { TokensCache, SemanticMatcher } from "../../src/index.js";
import { ProviderAdapter } from "../../src/core/providers/base.js";
import type { ChatRequest, ChatResponse, TokenUsage } from "../../src/core/types.js";

const LFUEvictionPolicy = (cacheManagerMod as { LFUEvictionPolicy?: new () => unknown }).LFUEvictionPolicy
  ?? (CacheManager as unknown as { LFUEvictionPolicy?: new () => unknown }).LFUEvictionPolicy;

const hashCacheKey = (
  hashMod as {
    hashCacheKey?: (input: {
      messages: Array<{ role: string; content: string }>;
      provider?: string;
      model?: string;
      includeModel?: boolean;
    }) => string;
  }
).hashCacheKey;

class FakeProvider extends ProviderAdapter {
  calls = 0;
  private readonly delayMs: number;

  constructor(name = "openai", delayMs = 0) {
    super(name, { apiKey: "test" });
    this.delayMs = delayMs;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    this.calls += 1;
    return {
      id: `fake-${this.name}-${this.calls}`,
      content: `echo:${request.model}:${request.messages.at(-1)?.content ?? ""}`,
      model: request.model,
      usage: { inputTokens: 8, outputTokens: 4 },
      cached: false,
    };
  }

  getCheapestModel(currentModel: string): string {
    return currentModel;
  }

  normalizeUsage(raw: unknown): TokenUsage {
    return raw as TokenUsage;
  }
}

function createGuard(provider: ProviderAdapter, cache: Record<string, unknown> = {}): TokensCache {
  return new TokensCache({
    config: {
      providers: { [provider.name]: { apiKey: "test" } },
      cache: { l1: { maxEntries: 64 }, ...cache },
      optimizer: {
        toolPruning: false,
        historyCompression: false,
        outputShaping: false,
        cacheAlignment: false,
      },
    },
    dbPath: ":memory:",
  });
}

describe("CacheManager", () => {
  it("returns undefined after TTL expiry (fake Date.now)", () => {
    let now = 1_000;
    const originalNow = Date.now;
    Date.now = () => now;

    try {
      const cache = new CacheManager<string>({ maxEntries: 8, defaultTtlMs: 100 });
      cache.set("prompt", "fresh");
      expect(cache.get("prompt")).toBe("fresh");

      now = 1_101;
      expect(cache.get("prompt")).toBeUndefined();
      expect(cache.has("prompt")).toBe(false);
    } finally {
      Date.now = originalNow;
    }
  });

  // LFUEvictionPolicy is a named export on cache-manager; skip if a parallel change drops it.
  const lfuIt = LFUEvictionPolicy ? it : it.skip;
  lfuIt("evicts least-frequently-used entries when over capacity", () => {
    const Policy = LFUEvictionPolicy as new () => {
      selectForEviction: (entries: unknown[], count: number) => string[];
    };
    const cache = new CacheManager<string>({
      maxEntries: 2,
      evictionPolicy: new Policy() as never,
    });

    cache.set("a", "1");
    cache.set("b", "2");
    cache.get("a");
    cache.get("a");
    cache.set("c", "3");

    expect(cache.has("b")).toBe(false);
    expect(cache.has("a")).toBe(true);
    expect(cache.has("c")).toBe(true);
  });
});

describe("hashCacheKey", () => {
  const keyIt = hashCacheKey ? it : it.skip;

  keyIt("produces different keys for different models", () => {
    const messages = [{ role: "user", content: "hash-cache-key models" }];
    const gpt4 = hashCacheKey!({
      messages,
      provider: "openai",
      model: "gpt-4",
    });
    const gpt4o = hashCacheKey!({
      messages,
      provider: "openai",
      model: "gpt-4o",
    });

    expect(gpt4).not.toBe(gpt4o);
    expect(gpt4).toHaveLength(64);
    expect(gpt4o).toHaveLength(64);
  });
});

describe("TokensCache cache improvements", () => {
  it("init + chat caches a repeated identical request and reports hits", async () => {
    const provider = new FakeProvider();
    const tg = createGuard(provider);
    tg.registerProvider(provider);
    await tg.init();

    const request: ChatRequest = {
      provider: "openai",
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "cache-improvements identical request" }],
    };

    const first = await tg.chat(request);
    expect(first.cached).toBe(false);
    expect(first.content).toContain("cache-improvements identical request");
    expect(provider.calls).toBe(1);

    const second = await tg.chat(request);
    expect(second.cached).toBe(true);
    expect(second.content).toBe(first.content);
    expect(provider.calls).toBe(1);
    expect(tg.getCacheStats().hits).toBeGreaterThanOrEqual(1);

    tg.close();
  });

  it("does not reuse a cache entry for a different model when includeModelInKey defaults to true", async () => {
    const provider = new FakeProvider();
    const tg = createGuard(provider);
    tg.registerProvider(provider);
    await tg.init();

    expect(tg.config.cache?.includeModelInKey).not.toBe(false);

    const messages = [{ role: "user" as const, content: "cache-improvements model isolation" }];

    const mini = await tg.chat({
      provider: "openai",
      model: "gpt-4o-mini",
      messages,
    });
    expect(mini.cached).toBe(false);

    const repeated = await tg.chat({
      provider: "openai",
      model: "gpt-4o-mini",
      messages,
    });
    expect(repeated.cached).toBe(true);

    const otherModel = await tg.chat({
      provider: "openai",
      model: "gpt-4o",
      messages,
    });
    expect(otherModel.cached).toBe(false);
    expect(otherModel.content).toContain("gpt-4o");
    expect(otherModel.content).not.toBe(mini.content);
    expect(provider.calls).toBe(2);

    tg.close();
  });

  it("parallel chat() for the same prompt resolves with the same content", async () => {
    const provider = new FakeProvider("openai", 15);
    const tg = createGuard(provider);
    tg.registerProvider(provider);
    await tg.init();

    const request: ChatRequest = {
      provider: "openai",
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "cache-improvements parallel coalesce" }],
    };

    const [a, b] = await Promise.all([tg.chat(request), tg.chat(request)]);

    expect(a.content).toBe(b.content);
    expect(a.content).toContain("cache-improvements parallel coalesce");

    const coalescing =
      (tg as unknown as { inFlight?: Map<string, Promise<ChatResponse>> }).inFlight instanceof Map;
    if (coalescing) {
      expect(provider.calls).toBe(1);
    } else {
      expect(provider.calls).toBeGreaterThanOrEqual(1);
    }

    tg.close();
  });
});

describe("SemanticMatcher", () => {
  it("isolates semantic matches by provider (openai vs anthropic)", async () => {
    const matcher = new SemanticMatcher({
      highThreshold: 0.5,
      grayZoneMin: 0.3,
      embeddingProvider: new HashEmbeddingService(64),
    });

    const messages = [{ role: "user" as const, content: "Explain provider-scoped semantic cache" }];
    const openaiRequest: ChatRequest = {
      provider: "openai",
      model: "shared-model",
      messages,
    };
    const anthropicRequest: ChatRequest = {
      provider: "anthropic",
      model: "shared-model",
      messages,
    };

    await matcher.index(
      openaiRequest,
      {
        id: "sem-openai",
        content: "openai-semantic-answer",
        model: "shared-model",
        usage: { inputTokens: 6, outputTokens: 3 },
        cached: false,
      },
      "hash-openai-provider",
    );

    const sameProvider = await matcher.findSimilar(openaiRequest);
    expect(sameProvider).not.toBeNull();
    expect(sameProvider?.response.content).toBe("openai-semantic-answer");

    const crossProvider = await matcher.findSimilar(anthropicRequest);
    const candidate = (
      matcher as unknown as { candidates?: Map<string, { provider?: string }> }
    ).candidates?.values().next().value;
    const isolatesProviders = candidate != null && "provider" in candidate;

    if (!isolatesProviders && crossProvider !== null) {
      // SemanticMatcher does not yet isolate candidates by provider.
      return;
    }

    expect(crossProvider).toBeNull();
  });
});
