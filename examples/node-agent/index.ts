/**
 * Minimal TokensCache usage — in-memory cache + mock provider (no API keys required).
 * Run: npx tsx examples/node-agent/index.ts
 */

import { TokensCache } from "../../src/index.js";
import { ProviderAdapter, type ProviderAdapterConfig } from "../../src/core/providers/base.js";
import type { ChatRequest, ChatResponse, TokenUsage } from "../../src/core/types.js";

class MockProvider extends ProviderAdapter {
  constructor(config: ProviderAdapterConfig = {}) {
    super("mock", config);
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const lastUser = [...request.messages].reverse().find((m) => m.role === "user");
    return {
      id: crypto.randomUUID(),
      content: `Mock reply to: ${lastUser?.content ?? "(empty)"}`,
      model: request.model,
      usage: { inputTokens: 50, outputTokens: 20 },
      cached: false,
    };
  }

  getCheapestModel(currentModel: string): string {
    return currentModel;
  }

  normalizeUsage(raw: unknown): TokenUsage {
    const u = raw as { inputTokens?: number; outputTokens?: number };
    return { inputTokens: u.inputTokens ?? 0, outputTokens: u.outputTokens ?? 0 };
  }
}

async function main(): Promise<void> {
  const guard = new TokensCache({
    config: {
      providers: { mock: {} },
      cache: { l1: { maxEntries: 100 } },
    },
    sessionId: "demo-session",
  });

  guard.registerProvider(new MockProvider());

  const request = {
    provider: "mock",
    model: "mock-v1",
    messages: [{ role: "user" as const, content: "What is semantic caching?" }],
  };

  const first = await guard.chat(request);
  console.log("First call (miss):", first.content, "| cached:", first.cached);

  const second = await guard.chat(request);
  console.log("Second call (hit):", second.content, "| cached:", second.cached);

  console.log("Cache stats:", guard.getCacheStats());
  guard.close();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
