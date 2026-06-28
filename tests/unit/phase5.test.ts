import { describe, it, expect } from "vitest";
import { pruneTools } from "../../src/core/optimizer/tool-pruner.js";
import { routeContent } from "../../src/core/optimizer/content-router.js";
import { compressHistory } from "../../src/core/optimizer/history-compressor.js";
import { shapeOutput } from "../../src/core/optimizer/output-shaper.js";
import { alignForProviderCache } from "../../src/core/optimizer/cache-aligner.js";
import type { ChatMessage } from "../../src/core/types.js";

describe("Phase 5 — optimizer", () => {
  it("prunes irrelevant tools", () => {
    const tools = [
      { function: { name: "search_web", description: "Search the web" } },
      { function: { name: "query_database", description: "Run SQL queries" } },
      { function: { name: "send_email", description: "Send email messages" } },
    ];

    const messages: ChatMessage[] = [
      { role: "user", content: "Please run a SQL query for active users" },
    ];

    const pruned = pruneTools(tools, messages, { maxTools: 1 });
    expect(pruned).toHaveLength(1);
    expect((pruned![0] as { function: { name: string } }).function.name).toBe("query_database");
  });

  it("routes JSON content to compress strategy", () => {
    const route = routeContent('{"users":[{"id":1}]}');
    expect(route.type).toBe("json");
    expect(route.strategy).toBe("compress");
  });

  it("compresses long history locally", async () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "You are helpful." },
      ...Array.from({ length: 20 }, (_, i) => ({
        role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
        content: `turn ${i} `.repeat(200),
      })),
    ];

    const compressed = await compressHistory(messages, {
      keepLastTurns: 2,
      compressionTrigger: 0.01,
      maxMessageChars: 200,
    });

    expect(compressed.length).toBeLessThan(messages.length);
  });

  it("shapes verbose assistant outputs under budget pressure", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "x".repeat(5000) },
      { role: "user", content: "latest" },
      { role: "assistant", content: "keep me" },
    ];

    const shaped = shapeOutput(messages, { triggerRatio: 0.99, maxChars: 100 });
    expect(shaped[1]!.content.length).toBeLessThan(5000);
    expect(shaped[3]!.content).toBe("keep me");
  });

  it("aligns cache prefix and applies Gemini storage gate", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "Stable system instructions." },
      { role: "user", content: "What is the weather today in NYC?" },
    ];

    const aligned = alignForProviderCache(messages, {}, {
      provider: "google",
      model: "gemini-2.0-flash",
      cachedTokenEstimate: 50_000,
    });

    expect(aligned.stablePrefix.length).toBeGreaterThan(0);
    expect(aligned.dynamicTail).toContain("today");
    expect(typeof aligned.geminiStorageAllowed).toBe("boolean");
    expect(aligned.estimatedStorageUsdPerHour).toBeGreaterThan(0);
  });
});
