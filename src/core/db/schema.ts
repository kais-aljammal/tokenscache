/**
 * SQLite schema initialization for TokensCache L3 cache, ledger, and sessions.
 * Adapted from GPTCache cache-manager persistence patterns (MIT, patterns extracted).
 */

export const SCHEMA_VERSION = 1;

export const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY
  )`,

  `CREATE TABLE IF NOT EXISTS cache_entries (
    id TEXT PRIMARY KEY,
    prompt_hash TEXT NOT NULL,
    prompt_normalized TEXT NOT NULL,
    response TEXT NOT NULL,
    embedding BLOB,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    hit_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_accessed_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT
  )`,

  `CREATE INDEX IF NOT EXISTS idx_cache_prompt_hash ON cache_entries(prompt_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_cache_provider ON cache_entries(provider)`,
  `CREATE INDEX IF NOT EXISTS idx_cache_last_accessed ON cache_entries(last_accessed_at)`,

  `CREATE TABLE IF NOT EXISTS ledger_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    cache_write_tokens INTEGER NOT NULL DEFAULT 0,
    cache_storage_usd REAL NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    request_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE INDEX IF NOT EXISTS idx_ledger_session ON ledger_entries(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ledger_provider ON ledger_entries(provider)`,
  `CREATE INDEX IF NOT EXISTS idx_ledger_created ON ledger_entries(created_at)`,

  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at TEXT,
    total_cost_usd REAL NOT NULL DEFAULT 0,
    metadata TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS pricing_metadata (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_verified TEXT NOT NULL,
    raw_json TEXT NOT NULL
  )`,
];

export interface DatabaseAdapter {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
}

/**
 * Initialize all schema tables and record schema version.
 */
export function initializeSchema(db: DatabaseAdapter): void {
  for (const sql of MIGRATIONS) {
    db.exec(sql);
  }

  const versionRow = db.prepare("SELECT version FROM schema_version LIMIT 1").get() as
    | { version: number }
    | undefined;

  if (!versionRow) {
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(SCHEMA_VERSION);
  }
}

/**
 * Record pricing config freshness in the database.
 */
export function syncPricingMetadata(db: DatabaseAdapter, lastVerified: string, rawJson: string): void {
  db.prepare(
    `INSERT INTO pricing_metadata (id, last_verified, raw_json)
     VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET last_verified = excluded.last_verified, raw_json = excluded.raw_json`,
  ).run(lastVerified, rawJson);
}
