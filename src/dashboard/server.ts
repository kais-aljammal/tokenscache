import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openDatabase } from "../core/db/index.js";
import type { DatabaseAdapter } from "../core/db/schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const UI_DIR = join(__dirname, "ui");

export interface DashboardMetrics {
  totalSpendUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  cacheReadTokens: number;
  cacheHits: number;
  sessionCount: number;
  recentEntries: number;
}

export interface DashboardBudgetStatus {
  spentUsd: number;
  sessionSpendUsd: number;
  dailySpendUsd: number;
}

export async function queryDashboardMetrics(adapter: DatabaseAdapter): Promise<DashboardMetrics> {
  const totals = adapter
    .prepare(
      `SELECT
         COALESCE(SUM(cost_usd), 0) as totalSpendUsd,
         COALESCE(SUM(input_tokens), 0) as totalInputTokens,
         COALESCE(SUM(output_tokens), 0) as totalOutputTokens,
         COALESCE(SUM(cache_read_tokens), 0) as cacheReadTokens,
         COALESCE(SUM(CASE WHEN cache_read_tokens > 0 THEN 1 ELSE 0 END), 0) as cacheHits
       FROM ledger_entries`,
    )
    .get() as {
    totalSpendUsd: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    cacheReadTokens: number;
    cacheHits: number;
  };

  const sessionRow = adapter
    .prepare(`SELECT COUNT(*) as sessionCount FROM sessions`)
    .get() as { sessionCount: number };

  const recentRow = adapter
    .prepare(
      `SELECT COUNT(*) as recentEntries
       FROM ledger_entries
       WHERE created_at >= datetime('now', '-24 hours')`,
    )
    .get() as { recentEntries: number };

  return {
    ...totals,
    sessionCount: sessionRow.sessionCount,
    recentEntries: recentRow.recentEntries,
  };
}

export async function queryBudgetStatus(adapter: DatabaseAdapter): Promise<DashboardBudgetStatus> {
  const sessionRow = adapter
    .prepare(`SELECT COALESCE(SUM(total_cost_usd), 0) as sessionSpendUsd FROM sessions`)
    .get() as { sessionSpendUsd: number };

  const dailySince = new Date();
  dailySince.setUTCHours(0, 0, 0, 0);

  const dailyRow = adapter
    .prepare(
      `SELECT COALESCE(SUM(cost_usd), 0) as dailySpendUsd
       FROM ledger_entries
       WHERE created_at >= ?`,
    )
    .get(dailySince.toISOString()) as { dailySpendUsd: number };

  return {
    spentUsd: sessionRow.sessionSpendUsd,
    sessionSpendUsd: sessionRow.sessionSpendUsd,
    dailySpendUsd: dailyRow.dailySpendUsd,
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendFile(res: ServerResponse, filePath: string, contentType: string): void {
  const content = readFileSync(filePath);
  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": content.length,
  });
  res.end(content);
}

export function createDashboardHandler(dbPath: string) {
  let adapterPromise: Promise<DatabaseAdapter> | null = null;

  async function getAdapter(): Promise<DatabaseAdapter> {
    if (!adapterPromise) {
      adapterPromise = openDatabase({ dbPath, loadPricing: false }).then((db) => db.adapter);
    }
    return adapterPromise;
  }

  return (req: IncomingMessage, res: ServerResponse): void => {
    void handleDashboardRequest(req, res, getAdapter);
  };
}

async function handleDashboardRequest(
  req: IncomingMessage,
  res: ServerResponse,
  getAdapter: () => Promise<DatabaseAdapter>,
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "GET" && url.pathname === "/api/metrics") {
    const adapter = await getAdapter();
    const metrics = await queryDashboardMetrics(adapter);
    sendJson(res, 200, metrics);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/budget") {
    const adapter = await getAdapter();
    const budget = await queryBudgetStatus(adapter);
    sendJson(res, 200, budget);
    return;
  }

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    const indexPath = join(UI_DIR, "index.html");
    if (existsSync(indexPath)) {
      sendFile(res, indexPath, "text/html; charset=utf-8");
      return;
    }
    sendJson(res, 404, { error: "Dashboard UI not found" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { status: "ok", service: "tokenguard-dashboard" });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

export interface DashboardServerOptions {
  port?: number;
  host?: string;
  dbPath?: string;
}

export function startDashboardServer(options: DashboardServerOptions = {}): http.Server {
  const port = options.port ?? Number(process.env.TOKENGUARD_DASHBOARD_PORT ?? 7432);
  const host = options.host ?? "127.0.0.1";
  const dbPath = options.dbPath ?? process.env.TOKENGUARD_DB_PATH ?? "./tokenguard.db";
  const server = http.createServer(createDashboardHandler(dbPath));
  server.listen(port, host);
  return server;
}

const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  const port = Number(process.env.TOKENGUARD_DASHBOARD_PORT ?? 7432);
  const server = startDashboardServer({ port });
  server.on("listening", () => {
    const addr = server.address();
    const boundPort = typeof addr === "object" && addr ? addr.port : port;
    process.stderr.write(`[TokenGuard Dashboard] http://127.0.0.1:${boundPort}\n`);
  });
}
