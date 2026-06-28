import { createHash } from "node:crypto";
import type { ChatMessage } from "../types.js";

/**
 * Normalize messages for deterministic cache keying.
 */
export function normalizeMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content.trim().replace(/\s+/g, " "),
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
