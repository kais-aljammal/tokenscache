import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadPricingConfig,
  resolveModelTier,
  estimateUsageCost,
  clearPricingCache,
} from "../../src/core/budget/pricing.js";
import { BudgetEnforcer } from "../../src/core/budget/enforcer.js";
import { ModelRouter } from "../../src/core/budget/router.js";
import { AnthropicProvider } from "../../src/core/providers/anthropic.js";
import { OpenAIProvider } from "../../src/core/providers/openai.js";
import { GeminiProvider } from "../../src/core/providers/gemini.js";
import { openDatabase } from "../../src/core/db/index.js";
import { TokenGuardConfigSchema } from "../../src/core/types.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const pricingPath = join(fileURLToPath(new URL("../../config/pricing.json", import.meta.url)));

describe("Phase 6 — pricing", () => {
  beforeEach(() => clearPricingCache());

  it("loads pricing.json", () => {
    const pricing = loadPricingConfig(pricingPath);
    expect(pricing.anthropic.sonnet_tier.input).toBe(3.0);
    expect(pricing._meta.last_verified).toBeDefined();
  });

  it("resolves model tiers", () => {
    expect(resolveModelTier("anthropic", "claude-3-opus-20240229")).toBe("opus_tier");
    expect(resolveModelTier("openai", "gpt-4o")).toBe("flagship_tier");
    expect(resolveModelTier("google", "gemini-2.0-flash")).toBe("flash_tier");
  });

  it("estimates usage cost in USD", () => {
    const cost = estimateUsageCost(
      "openai",
      "gpt-4o",
      { inputTokens: 1_000_000, outputTokens: 0 },
      loadPricingConfig(pricingPath),
    );
    expect(cost.inputUsd).toBe(5.0);
    expect(cost.totalUsd).toBe(5.0);
  });
});

describe("Phase 6 — budget enforcer", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tokenguard-budget-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("blocks requests when hard budget exceeded", async () => {
    const { adapter, close } = await openDatabase({
      dbPath: join(dir, "budget.db"),
      loadPricing: false,
    });

    const config = TokenGuardConfigSchema.parse({
      providers: { openai: { apiKey: "test" } },
      budget: {
        hard: { usd: 0.001, action: "block" },
      },
    });

    const enforcer = new BudgetEnforcer({
      adapter,
      config,
      sessionId: "sess-1",
    });

    const request = {
      provider: "openai",
      model: "gpt-4o",
      messages: [{ role: "user" as const, content: "x".repeat(8000) }],
    };

    enforcer.record(request, { inputTokens: 5000, outputTokens: 2000 });

    const check = enforcer.check(request, { inputTokens: 5000, outputTokens: 2000 });
    expect(check.allowed).toBe(false);
    expect(check.action).toBe("block");

    close();
  });
});

describe("Phase 6 — model router", () => {
  it("downgrades flagship models", () => {
    const router = new ModelRouter();
    const routed = router.route(
      {
        provider: "openai",
        model: "gpt-4o",
        messages: [],
      },
      "downgrade",
    );
    expect(routed.model).toBe("gpt-4o-mini");
  });
});

describe("Phase 6 — provider adapters", () => {
  it("normalizes Anthropic usage", () => {
    const provider = new AnthropicProvider({ apiKey: "test" });
    const usage = provider.normalizeUsage({
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: 2,
      cache_creation_input_tokens: 1,
    });
    expect(usage.inputTokens).toBe(10);
    expect(usage.cacheReadTokens).toBe(2);
  });

  it("normalizes OpenAI usage", () => {
    const provider = new OpenAIProvider({ apiKey: "test" });
    const usage = provider.normalizeUsage({
      prompt_tokens: 12,
      completion_tokens: 4,
      prompt_tokens_details: { cached_tokens: 3 },
    });
    expect(usage.cacheReadTokens).toBe(3);
  });

  it("selects cheapest Gemini model", () => {
    const provider = new GeminiProvider({ apiKey: "test" });
    expect(provider.getCheapestModel("gemini-2.0-pro")).toBe("gemini-2.0-flash");
    expect(provider.getCheapestModel("gemini-2.0-flash")).toBe("gemini-2.0-flash-lite");
  });
});
