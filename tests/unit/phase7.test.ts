import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TokensCache } from "../../src/index.js";
import {
  isAllowedProviderHost,
  isAllowedUpstreamUrl,
  createProxyHandler,
  createTokensCache,
} from "../../src/proxy/server.js";
import { listMcpTools, handleMcpRequest } from "../../src/proxy/mcp-server.js";
import {
  createDashboardHandler,
  queryDashboardMetrics,
  queryBudgetStatus,
} from "../../src/dashboard/server.js";
import { openDatabase } from "../../src/core/db/index.js";
import { ProviderAdapter } from "../../src/core/providers/base.js";
import type { ChatRequest, ChatResponse, TokenUsage } from "../../src/core/types.js";

class MockProvider extends ProviderAdapter {
  constructor() {
    super("openai", { apiKey: "test" });
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    return {
      id: "mock-1",
      content: `echo: ${request.messages.at(-1)?.content ?? ""}`,
      model: request.model,
      usage: { inputTokens: 10, outputTokens: 5 },
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

function requestJson(
  port: number,
  path: string,
  method = "GET",
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: payload
          ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
          : {},
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body: JSON.parse(Buffer.concat(chunks).toString("utf-8")) as Record<string, unknown>,
          });
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe("Phase 7 — proxy routing", () => {
  it("allows whitelisted provider domains", () => {
    expect(isAllowedProviderHost("api.openai.com")).toBe(true);
    expect(isAllowedProviderHost("api.anthropic.com")).toBe(true);
    expect(isAllowedProviderHost("generativelanguage.googleapis.com")).toBe(true);
    expect(isAllowedProviderHost("evil.example.com")).toBe(false);
  });

  it("rejects non-whitelisted upstream URLs", () => {
    expect(isAllowedUpstreamUrl("https://api.openai.com/v1/chat/completions")).toBe(true);
    expect(isAllowedUpstreamUrl("https://malicious.site/steal")).toBe(false);
  });

  it("blocks provider config with non-whitelisted baseUrl", () => {
    expect(() =>
      createTokensCache({
        providers: {
          openai: { apiKey: "test", baseUrl: "https://evil.proxy/hook" },
        },
      }),
    ).toThrow("not whitelisted");
  });

  it("routes chat completions through TokensCache", async () => {
    const tg = new TokensCache({
      config: { providers: { openai: { apiKey: "test" } } },
      dbPath: ":memory:",
    });
    tg.registerProvider(new MockProvider());

    const server = http.createServer(createProxyHandler(tg, "openai"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;

    const first = await requestJson(port, "/v1/chat/completions", "POST", {
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hello proxy" }],
    });

    expect(first.status).toBe(200);
    const choices = first.body.choices as Array<{ message: { content: string } }>;
    expect(choices[0]?.message.content).toContain("hello proxy");
    expect((first.body.tokenscache as { cached: boolean }).cached).toBe(false);

    const second = await requestJson(port, "/v1/chat/completions", "POST", {
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hello proxy" }],
    });
    expect((second.body.tokenscache as { cached: boolean }).cached).toBe(true);

    await new Promise<void>((resolve) => server.close(() => resolve()));
    tg.close();
  });
});

describe("Phase 7 — MCP server", () => {
  let tg: TokensCache;

  beforeEach(() => {
    tg = new TokensCache({
      config: { providers: { openai: { apiKey: "test" } } },
      dbPath: ":memory:",
    });
    tg.registerProvider(new MockProvider());
  });

  afterEach(() => {
    tg.close();
  });

  it("lists all TokensCache MCP tools", () => {
    expect(listMcpTools().map((t) => t.name)).toEqual([
      "tc_chat",
      "tc_cache_stats",
      "tc_cache_invalidate",
      "tc_budget_status",
      "tc_compress_context",
      "tc_audit",
    ]);
  });

  it("handles tools/list JSON-RPC request", async () => {
    const response = await handleMcpRequest(
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      tg,
    );
    const tools = (response.result as { tools: Array<{ name: string }> }).tools;
    expect(tools).toHaveLength(6);
    expect(tools[0]?.name).toBe("tc_chat");
  });

  it("executes tc_chat via tools/call", async () => {
    const response = await handleMcpRequest(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "tc_chat",
          arguments: {
            provider: "openai",
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: "mcp test" }],
          },
        },
      },
      tg,
    );

    const content = (response.result as { content: Array<{ text: string }> }).content[0]?.text;
    expect(content).toContain("mcp test");
  });
});

describe("Phase 7 — dashboard endpoints", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tokenscache-dash-"));
    dbPath = join(dir, "dash.db");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("queries metrics and budget from SQLite ledger", async () => {
    const { adapter, close } = await openDatabase({ dbPath, loadPricing: false });
    adapter.prepare(`INSERT OR IGNORE INTO sessions (id) VALUES (?)`).run("sess-a");
    adapter
      .prepare(
        `INSERT INTO ledger_entries
         (session_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cost_usd)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("sess-a", "openai", "gpt-4o-mini", 100, 50, 20, 0.002);

    const metrics = await queryDashboardMetrics(adapter);
    expect(metrics.totalSpendUsd).toBeCloseTo(0.002);
    expect(metrics.cacheHits).toBe(1);
    expect(metrics.cacheReadTokens).toBe(20);

    const budget = await queryBudgetStatus(adapter);
    expect(budget.sessionSpendUsd).toBeCloseTo(0.002);

    close();
  });

  it("serves dashboard API and HTML", async () => {
    const { adapter, close, persist } = await openDatabase({ dbPath, loadPricing: false });
    adapter.prepare(`INSERT OR IGNORE INTO sessions (id) VALUES (?)`).run("sess-b");
    adapter
      .prepare(
        `INSERT INTO ledger_entries
         (session_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cost_usd)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("sess-b", "openai", "gpt-4o-mini", 10, 5, 0, 0.001);
    persist();
    close();

    const server = http.createServer(createDashboardHandler(dbPath));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;

    const metrics = await requestJson(port, "/api/metrics");
    expect(metrics.status).toBe(200);
    expect(metrics.body.totalSpendUsd).toBeCloseTo(0.001);

    const budget = await requestJson(port, "/api/budget");
    expect(budget.status).toBe(200);
    expect(budget.body.dailySpendUsd).toBeGreaterThanOrEqual(0);

    const html = await new Promise<{ status: number; text: string }>((resolve, reject) => {
      http
        .get({ hostname: "127.0.0.1", port, path: "/" }, (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () =>
            resolve({
              status: res.statusCode ?? 0,
              text: Buffer.concat(chunks).toString("utf-8"),
            }),
          );
        })
        .on("error", reject);
    });
    expect(html.status).toBe(200);
    expect(html.text).toContain("TokensCache Dashboard");

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});

describe("Phase 7 — TokensCache pipeline", () => {
  it("uses CacheRouter for repeated chat requests", async () => {
    const tg = new TokensCache({
      config: { providers: { openai: { apiKey: "test" } } },
      dbPath: ":memory:",
    });
    tg.registerProvider(new MockProvider());

    const request = {
      provider: "openai",
      model: "gpt-4o-mini",
      messages: [{ role: "user" as const, content: "pipeline test" }],
    };

    const first = await tg.chat(request);
    expect(first.cached).toBe(false);

    const second = await tg.chat(request);
    expect(second.cached).toBe(true);
    expect(tg.getCacheStats().hits).toBe(1);

    tg.close();
  });
});
