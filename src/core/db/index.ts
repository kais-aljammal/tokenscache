import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import {
  initializeSchema,
  syncPricingMetadata,
  type DatabaseAdapter,
} from "./schema.js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function wrapSqlJs(db: SqlJsDatabase): DatabaseAdapter {
  return {
    exec(sql: string) {
      db.run(sql);
    },
    prepare(sql: string) {
      return {
        run(...params: unknown[]) {
          db.run(sql, params as (string | number | null)[]);
          return { changes: db.getRowsModified() };
        },
        get(...params: unknown[]) {
          const stmt = db.prepare(sql);
          try {
            stmt.bind(params as (string | number | null)[]);
            if (stmt.step()) {
              return stmt.getAsObject();
            }
            return undefined;
          } finally {
            stmt.free();
          }
        },
        all(...params: unknown[]) {
          const stmt = db.prepare(sql);
          const rows: unknown[] = [];
          try {
            stmt.bind(params as (string | number | null)[]);
            while (stmt.step()) {
              rows.push(stmt.getAsObject());
            }
          } finally {
            stmt.free();
          }
          return rows;
        },
      };
    },
  };
}

export interface DatabaseOptions {
  dbPath: string;
  loadPricing?: boolean;
}

export interface TokensCacheDatabase {
  db: SqlJsDatabase;
  adapter: DatabaseAdapter;
  persist(): void;
  close(): void;
}

let sqlJsModule: Awaited<ReturnType<typeof initSqlJs>> | null = null;

async function getSqlJs(): Promise<Awaited<ReturnType<typeof initSqlJs>>> {
  if (!sqlJsModule) {
    sqlJsModule = await initSqlJs();
  }
  return sqlJsModule;
}

/**
 * Open SQLite database via sql.js (WASM, no native build required).
 * Persists to disk on close() when dbPath is not :memory:.
 */
export async function openDatabase(options: DatabaseOptions): Promise<TokensCacheDatabase> {
  const SQL = await getSqlJs();
  const isMemory = options.dbPath === ":memory:";

  let db: SqlJsDatabase;
  if (!isMemory && existsSync(options.dbPath)) {
    const buffer = readFileSync(options.dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  const adapter = wrapSqlJs(db);
  initializeSchema(adapter);

  if (options.loadPricing !== false) {
    try {
      const pricingPath = join(__dirname, "../../config/pricing.json");
      const raw = readFileSync(pricingPath, "utf-8");
      const parsed = JSON.parse(raw) as { _meta?: { last_verified?: string } };
      const lastVerified = parsed._meta?.last_verified ?? new Date().toISOString().slice(0, 10);
      syncPricingMetadata(adapter, lastVerified, raw);
    } catch {
      // Pricing file optional during early setup
    }
  }

  const dbPath = options.dbPath;

  return {
    db,
    adapter,
    persist() {
      if (!isMemory) {
        writeFileSync(dbPath, Buffer.from(db.export()));
      }
    },
    close() {
      if (!isMemory) {
        writeFileSync(dbPath, Buffer.from(db.export()));
      }
      db.close();
    },
  };
}

export { initializeSchema, syncPricingMetadata, SCHEMA_VERSION, MIGRATIONS } from "./schema.js";
