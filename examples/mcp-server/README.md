# TokenGuard MCP Server Example

This example documents how to run a TokenGuard-backed [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that exposes cache-aware chat tools to MCP clients (Cursor, Claude Desktop, custom agents).

## Prerequisites

- Node.js 20+
- TokenGuard built (`npm run build` from repo root)
- Provider API keys in environment variables (see below)

## Environment

```bash
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
export TOKENGUARD_DB_PATH=./tokenguard.db
```

## Run (stdio transport)

MCP servers typically communicate over stdio. From the repo root:

```bash
npm run build
npx tsx examples/mcp-server/server.ts
```

The example re-exports the stdio MCP server in `src/proxy/mcp-server.ts`.

Then register the server in your MCP client config. Example for Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "tokenguard": {
      "command": "npx",
      "args": ["tsx", "examples/mcp-server/server.ts"],
      "cwd": "/path/to/tokenguard",
      "env": {
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

## Exposed tools

| Tool | Description |
|------|-------------|
| `tg_chat` | Route a prompt through TokenGuard cache → optimizer → provider |
| `tg_cache_stats` | Return L1/L3 hit counts and session spend |
| `tg_cache_invalidate` | Invalidate by hash or clear all caches |
| `tg_budget_status` | Return session/daily budget utilization |
| `tg_compress_context` | Compress conversation history |
| `tg_audit` | Return recent ledger entries for the session |

## Integration pattern

1. Instantiate `TokenGuard` with `cache.semantic` and `budget` limits from config.
2. Call `await guard.init()` to open the SQLite ledger.
3. Register provider adapters (`OpenAIProvider`, `AnthropicProvider`, `GeminiProvider`).
4. Wrap `guard.chat()` in an MCP tool handler; return usage and `cached` flag to the client.

## Verify pricing before production

```bash
npm run sync-pricing
```

Re-run monthly or when providers change rates. Stale pricing (>30 days) exits non-zero.

## Related

- [Node agent example](../node-agent/index.ts) — minimal SDK usage without MCP
- [Browser React notes](../browser-react/README.md) — IndexedDB L2 cache in the browser
