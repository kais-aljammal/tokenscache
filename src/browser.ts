/**
 * Browser entry point — re-exports browser-safe APIs.
 * Node-only modules (better-sqlite3) are excluded; L2/L3 use sql.js + IndexedDB in later phases.
 */
export {
  TokenGuard,
  TokenGuardConfigSchema,
  CacheManager,
  LRUEvictionPolicy,
  FIFOEvictionPolicy,
  checkBudgetLimits,
} from "./index.js";

export type {
  TokenGuardConfig,
  ChatRequest,
  ChatResponse,
  ChatMessage,
} from "./index.js";

export { ProviderAdapter } from "./core/providers/base.js";
export { initializeSchema, SCHEMA_VERSION } from "./core/db/schema.js";
