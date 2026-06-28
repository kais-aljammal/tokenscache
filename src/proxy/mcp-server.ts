import readline from "node:readline";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { TokenGuard, type TokenGuardConfig } from "../index.js";
import type { ChatMessage } from "../core/types.js";
import { createTokenGuard } from "./server.js";

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: "tg_chat",
    description: "Send a chat completion through TokenGuard cache and budget pipeline",
    inputSchema: {
      type: "object",
      properties: {
        provider: { type: "string" },
        model: { type: "string" },
        messages: {
          type: "array",
          items: {
            type: "object",
            properties: {
              role: { type: "string" },
              content: { type: "string" },
            },
            required: ["role", "content"],
          },
        },
      },
      required: ["provider", "model", "messages"],
    },
  },
  {
    name: "tg_cache_stats",
    description: "Return TokenGuard cache hit/miss statistics",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "tg_cache_invalidate",
    description: "Invalidate cache entries by hash or clear all caches",
    inputSchema: {
      type: "object",
      properties: {
        hash: { type: "string", description: "Optional prompt hash; omit to clear all" },
      },
    },
  },
  {
    name: "tg_budget_status",
    description: "Return current session budget spend and limits",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "tg_compress_context",
    description: "Compress conversation history using the optimizer pipeline",
    inputSchema: {
      type: "object",
      properties: {
        messages: {
          type: "array",
          items: {
            type: "object",
            properties: {
              role: { type: "string" },
              content: { type: "string" },
            },
            required: ["role", "content"],
          },
        },
      },
      required: ["messages"],
    },
  },
  {
    name: "tg_audit",
    description: "Return recent ledger audit entries for the current session",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max entries to return (default 50)" },
      },
    },
  },
];

export function listMcpTools(): McpToolDefinition[] {
  return MCP_TOOLS;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function rpcResult(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}

function parseMessages(raw: unknown): ChatMessage[] {
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

export async function handleMcpRequest(
  request: JsonRpcRequest,
  tg: TokenGuard,
): Promise<JsonRpcResponse> {
  const id = request.id ?? null;

  try {
    switch (request.method) {
      case "initialize":
        return rpcResult(id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "tokenguard-mcp", version: "0.1.0" },
        });

      case "notifications/initialized":
        return rpcResult(id, {});

      case "tools/list":
        return rpcResult(id, { tools: listMcpTools() });

      case "tools/call": {
        const params = request.params ?? {};
        const toolName = params.name as string;
        const args = (params.arguments ?? {}) as Record<string, unknown>;
        const text = await executeMcpTool(tg, toolName, args);
        return rpcResult(id, {
          content: [{ type: "text", text }],
          isError: false,
        });
      }

      case "ping":
        return rpcResult(id, {});

      default:
        return rpcError(id, -32601, `Method not found: ${request.method}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "MCP tool error";
    return rpcError(id, -32000, message);
  }
}

export async function executeMcpTool(
  tg: TokenGuard,
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  await tg.init();

  switch (toolName) {
    case "tg_chat": {
      const response = await tg.chat({
        provider: String(args.provider ?? "openai"),
        model: String(args.model ?? "gpt-4o-mini"),
        messages: parseMessages(args.messages),
      });
      return JSON.stringify(response, null, 2);
    }
    case "tg_cache_stats":
      return JSON.stringify(tg.getCacheStats(), null, 2);
    case "tg_cache_invalidate": {
      const hash = typeof args.hash === "string" ? args.hash : undefined;
      await tg.invalidateCache(hash);
      return JSON.stringify({ invalidated: hash ?? "all" });
    }
    case "tg_budget_status":
      return JSON.stringify(tg.getBudgetStatus(), null, 2);
    case "tg_compress_context": {
      const compressed = await tg.compressContext(parseMessages(args.messages));
      return JSON.stringify({ messages: compressed }, null, 2);
    }
    case "tg_audit": {
      const limit = typeof args.limit === "number" ? args.limit : 50;
      return JSON.stringify(tg.getAuditLog(limit), null, 2);
    }
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

export function startMcpServer(tg: TokenGuard): void {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

  rl.on("line", (line) => {
    if (!line.trim()) return;

    let request: JsonRpcRequest;
    try {
      request = JSON.parse(line) as JsonRpcRequest;
    } catch {
      const response = rpcError(null, -32700, "Parse error");
      process.stdout.write(`${JSON.stringify(response)}\n`);
      return;
    }

    void handleMcpRequest(request, tg).then((response) => {
      if (request.id !== undefined) {
        process.stdout.write(`${JSON.stringify(response)}\n`);
      }
    });
  });
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
  startMcpServer(tg);
  process.stderr.write("[TokenGuard MCP] stdio JSON-RPC server ready\n");
}
