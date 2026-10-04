import { createHash } from "node:crypto";
import type { ChatMessage } from "../types.js";

/**
 * Normalize messages for deterministic cache keying.
 */
export function normalizeMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content.normalize("NFC").trim().replace(/\s+/g, " "),
  }));
}

/**
 * Serialize normalized messages to a stable JSON string.
 */
export function serializePrompt(messages: ChatMessage[]): string {
  return JSON.stringify(normalizeMessages(messages));
}

/**
 * SHA-256 hash of normalized prompt (Node.js).
 */
export async function hashPromptAsync(messages: ChatMessage[]): Promise<string> {
  const data = serializePrompt(messages);
  if (typeof globalThis.crypto?.subtle !== "undefined") {
    const encoded = new TextEncoder().encode(data);
    const buf = await globalThis.crypto.subtle.digest("SHA-256", encoded);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Sync hash for Node environments.
 */
export function hashPromptSync(messages: ChatMessage[]): string {
  const data = serializePrompt(messages);
  return createHash("sha256").update(data).digest("hex");
}

export interface CacheKeyInput {
  messages: Array<{ role: string; content: string }>;
  provider?: string;
  model?: string;
  tools?: unknown[];
  /** Default true when provider/model provided. */
  includeModel?: boolean;
  /** Default true when tools provided. */
  includeTools?: boolean;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val: unknown) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      return Object.fromEntries(
        Object.entries(val as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
      );
    }
    return val;
  });
}

/**
 * Serialize messages plus optional provider/model/tools into a stable cache key.
 */
export function serializeCacheKey(input: CacheKeyInput): string {
  const includeModel = input.includeModel ?? (input.provider != null || input.model != null);
  const includeTools = input.includeTools ?? input.tools != null;

  const payload: Record<string, unknown> = {
    messages: normalizeMessages(input.messages as ChatMessage[]),
  };

  if (includeModel) {
    if (input.provider !== undefined) payload.provider = input.provider;
    if (input.model !== undefined) payload.model = input.model;
  }

  if (includeTools) {
    payload.tools = input.tools ?? [];
  }

  return stableStringify(payload);
}

/**
 * SHA-256 hash of a full cache key (Node.js).
 */
export function hashCacheKey(input: CacheKeyInput): string {
  return createHash("sha256").update(serializeCacheKey(input)).digest("hex");
}
