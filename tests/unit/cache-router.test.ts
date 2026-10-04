import { describe, it, expect } from "vitest";
import { CacheRouter } from "../../src/core/cache/cache-router.js";
import type { ChatRequest, ChatResponse } from "../../src/core/types.js";

const mockResponse = (content: string): ChatResponse => ({
  id: "test-id",
  content,
  model: "test-model",
  usage: { inputTokens: 10, outputTokens: 5 },
  cached: false,
});

const request = (overrides: Partial<ChatRequest> = {}): ChatRequest => ({
  provider: "openai",
  model: "gpt-4o",
  messages: [{ role: "user", content: "hello" }],
  ...overrides,
});

describe("CacheRouter", () => {
  it("misses when the same prompt uses a different model (includeModelInKey default true)", async () => {
    const router = new CacheRouter({ l1MaxEntries: 100 });
    await router.store(request({ model: "gpt-4o" }), mockResponse("from-4o"));

    const result = await router.lookup(request({ model: "gpt-4o-mini" }));
    expect(result.hit).toBe(false);
    expect(router.hashRequest(request({ model: "gpt-4o" }))).not.toBe(
      router.hashRequest(request({ model: "gpt-4o-mini" })),
    );
  });

  it("hits when includeModelInKey is false and only the model differs", async () => {
    const router = new CacheRouter({ l1MaxEntries: 100, includeModelInKey: false });
    await router.store(request({ model: "gpt-4o" }), mockResponse("shared"));

    const result = await router.lookup(request({ model: "gpt-4o-mini" }));
    expect(result.hit).toBe(true);
    expect(result.layer).toBe("L1");
    expect(result.response?.content).toBe("shared");
  });

  it("increments layer hits and misses in getStats()", async () => {
    const router = new CacheRouter({ l1MaxEntries: 100 });
    await router.store(request(), mockResponse("world"));

    const hit = await router.lookup(request());
    expect(hit.hit).toBe(true);
    expect(hit.layer).toBe("L1");

    const miss = await router.lookup(request({ messages: [{ role: "user", content: "unknown" }] }));
    expect(miss.hit).toBe(false);

    const stats = router.getStats();
    expect(stats.hits.L1).toBe(1);
    expect(stats.hits.L2).toBe(0);
    expect(stats.hits.L3).toBe(0);
    expect(stats.hits.semantic).toBe(0);
    expect(stats.hits.artifact).toBe(0);
    expect(stats.misses).toBe(1);
    expect(stats.l1Size).toBeGreaterThan(0);
    expect(stats.inflightCoalesced).toBe(0);
  });

  it("invalidate() clears L1 so a subsequent lookup misses", async () => {
    const router = new CacheRouter({ l1MaxEntries: 100 });
    await router.store(request(), mockResponse("world"));
    expect((await router.lookup(request())).hit).toBe(true);

    await router.invalidate();
    const after = await router.lookup(request());
    expect(after.hit).toBe(false);
    expect(router.getStats().l1Size).toBe(0);
  });

  it("invalidate(hash) clears only that L1 entry", async () => {
    const router = new CacheRouter({ l1MaxEntries: 100 });
    const keep = request({ messages: [{ role: "user", content: "keep" }] });
    const drop = request({ messages: [{ role: "user", content: "drop" }] });
    await router.store(keep, mockResponse("kept"));
    await router.store(drop, mockResponse("dropped"));

    await router.invalidate(router.hashRequest(drop));
    expect((await router.lookup(drop)).hit).toBe(false);
    expect((await router.lookup(keep)).hit).toBe(true);
  });

  it("hits artifact-scoped cache for paraphrased agent prompts", async () => {
    const router = new CacheRouter({ l1MaxEntries: 100, agentArtifactScope: true });
    const first = request({
      messages: [{ role: "user", content: "Create a Cart class with add and remove." }],
      metadata: { artifact: "cart" },
    });
    const paraphrase = request({
      messages: [{ role: "user", content: "Build a shopping cart supporting add/remove." }],
      metadata: { artifact: "cart" },
    });

    await router.store(first, mockResponse("export class Cart {}"));

    const result = await router.lookup(paraphrase);
    expect(result.hit).toBe(true);
    expect(result.layer).toBe("artifact");
    expect(result.response?.content).toBe("export class Cart {}");
    expect(router.getStats().hits.artifact).toBe(1);
  });

  it("coalesces parallel lookups for the same hash", async () => {
    const router = new CacheRouter({ l1MaxEntries: 100 });
    await router.store(request(), mockResponse("world"));

    const [a, b] = await Promise.all([router.lookup(request()), router.lookup(request())]);
    expect(a.hit).toBe(true);
    expect(b.hit).toBe(true);
    expect(a).toEqual(b);
    expect(router.getStats().inflightCoalesced).toBe(1);
    expect(router.getStats().hits.L1).toBe(1);
  });

  it("runCoalesced joins in-flight work and tracks inflightCoalesced", async () => {
    const router = new CacheRouter({ l1MaxEntries: 100 });
    let calls = 0;
    const hash = router.hashRequest(request());

    const work = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return "done";
    };

    const [a, b] = await Promise.all([router.runCoalesced(hash, work), router.runCoalesced(hash, work)]);
    expect(a).toBe("done");
    expect(b).toBe("done");
    expect(calls).toBe(1);
    expect(router.getStats().inflightCoalesced).toBe(1);
  });

  it("keeps hashMessages messages-only while hashRequest isolates tools by default", () => {
    const router = new CacheRouter({ l1MaxEntries: 100 });
    const messages = [{ role: "user" as const, content: "hello" }];
    const withSearch = request({ messages, tools: [{ name: "search" }] });
    const withFetch = request({ messages, tools: [{ name: "fetch" }] });

    expect(router.hashMessages(withSearch.messages)).toBe(router.hashMessages(withFetch.messages));
    expect(router.hashRequest(withSearch)).not.toBe(router.hashRequest(withFetch));
  });
});
