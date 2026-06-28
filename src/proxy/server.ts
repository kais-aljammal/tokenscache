import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { TokenGuard, type TokenGuardConfig } from "../index.js";
import { AnthropicProvider, GeminiProvider, OpenAIProvider } from "../core/providers/index.js";
import {
  isAllowedUpstreamUrl,
} from "../core/providers/whitelist.js";
import type { ChatMessage, ChatRequest } from "../core/types.js";

export { ALLOWED_PROVIDER_DOMAINS, isAllowedProviderHost, isAllowedUpstreamUrl } from "../core/providers/whitelist.js";

const MAX_BODY_BYTES = 10 * 1024 * 1024;

export interface ProxyServerOptions {
  port?: number;
  host?: string;
  defaultProvider?: string;
  config?: TokenGuardConfig;
  dbPath?: string;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function parseOpenAIMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m): m is { role: string; content: string } => {
      return (
        typeof m === "object" &&
        m !== null &&
        typeof (m as { role?: unknown }).role === "string" &&
        typeof (m as { content?: unknown }).content === "string"
      );
    })
    .map((m) => ({
      role: m.role as ChatMessage["role"],
      content: m.content,
    }));
}

function toOpenAICompletion(response: {
  id: string;
  content: string;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
  };
  cached?: boolean;
  cacheLayer?: string;
}): Record<string, unknown> {
  return {
    id: response.id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: response.model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: response.content },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: response.usage.inputTokens,
      completion_tokens: response.usage.outputTokens,
      total_tokens: response.usage.inputTokens + response.usage.outputTokens,
      prompt_tokens_details: {
        cached_tokens: response.usage.cacheReadTokens ?? 0,
      },
    },
    tokenguard: {
      cached: response.cached ?? false,
      cache_layer: response.cacheLayer ?? null,
    },
  };
}

export function createTokenGuard(config: TokenGuardConfig, dbPath?: string): TokenGuard {
  const tg = new TokenGuard({ config, dbPath });
  registerProvidersFromConfig(tg, config);
  return tg;
}

export function registerProvidersFromConfig(tg: TokenGuard, config: TokenGuardConfig): void {
  for (const [name, providerConfig] of Object.entries(config.providers)) {
    const baseUrl = providerConfig.baseUrl;
    if (baseUrl && !isAllowedUpstreamUrl(baseUrl)) {
      throw new Error(`[TokenGuard Proxy] Blocked upstream URL (not whitelisted): ${baseUrl}`);
    }

    const key = name.toLowerCase();
    if (key === "openai") {
      tg.registerProvider(new OpenAIProvider(providerConfig));
    } else if (key === "anthropic") {
      tg.registerProvider(new AnthropicProvider(providerConfig));
    } else if (key === "google" || key === "gemini") {
      tg.registerProvider(new GeminiProvider(providerConfig));
    }
  }
}

export function createProxyHandler(
  tg: TokenGuard,
  defaultProvider = "openai",
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    void handleProxyRequest(req, res, tg, defaultProvider);
  };
}

async function handleProxyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  tg: TokenGuard,
  defaultProvider: string,
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { status: "ok", service: "tokenguard-proxy" });
    return;
  }

  if (req.method !== "POST" || url.pathname !== "/v1/chat/completions") {
    sendJson(res, 404, {
      error: {
        message: "Not found — use POST /v1/chat/completions",
        type: "invalid_request_error",
      },
    });
    return;
  }

  try {
    const rawBody = await readBody(req);
    const body = JSON.parse(rawBody) as {
      model?: string;
      messages?: unknown;
      tools?: unknown[];
      stream?: boolean;
      provider?: string;
    };

    if (body.stream) {
      sendJson(res, 400, {
        error: {
          message: "Streaming is not supported by TokenGuard proxy",
          type: "invalid_request_error",
        },
      });
      return;
    }

    const provider =
      (typeof body.provider === "string" ? body.provider : undefined) ??
      (req.headers["x-tg-provider"] as string | undefined) ??
      defaultProvider;

    const chatRequest: ChatRequest = {
      provider,
      model: body.model ?? "gpt-4o-mini",
      messages: parseOpenAIMessages(body.messages),
      tools: body.tools,
      stream: false,
    };

    await tg.init();
    const response = await tg.chat(chatRequest);
    sendJson(res, 200, toOpenAICompletion(response));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown proxy error";
    const status = message.includes("Budget exhausted") ? 429 : 500;
    sendJson(res, status, {
      error: { message, type: status === 429 ? "budget_exceeded" : "proxy_error" },
    });
  }
}

export function startProxyServer(
  tg: TokenGuard,
  options: ProxyServerOptions = {},
): http.Server {
  const port = options.port ?? Number(process.env.TOKENGUARD_PROXY_PORT ?? 7431);
  const host = options.host ?? "127.0.0.1";
  const defaultProvider = options.defaultProvider ?? "openai";
  const server = http.createServer(createProxyHandler(tg, defaultProvider));
  server.listen(port, host);
  return server;
}

function loadConfigFromEnv(): TokenGuardConfig {
  const configPath = process.env.TOKENGUARD_CONFIG;
  if (configPath) {
    return JSON.parse(readFileSync(configPath, "utf-8")) as TokenGuardConfig;
  }

  return {
    providers: {
      openai: { apiKey: process.env.OPENAI_API_KEY },
      anthropic: { apiKey: process.env.ANTHROPIC_API_KEY },
      google: { apiKey: process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY },
    },
  };
}

const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  const config = loadConfigFromEnv();
  const tg = createTokenGuard(config, process.env.TOKENGUARD_DB_PATH);
  const port = Number(process.env.TOKENGUARD_PROXY_PORT ?? 7431);
  const server = startProxyServer(tg, { port });
  server.on("listening", () => {
    const addr = server.address();
    const boundPort = typeof addr === "object" && addr ? addr.port : port;
    process.stderr.write(`[TokenGuard Proxy] listening on http://127.0.0.1:${boundPort}\n`);
  });
}
