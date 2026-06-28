import type { ChatMessage } from "../types.js";
import { routeContent } from "./content-router.js";

export interface HistoryCompressorOptions {
  keepSystem?: boolean;
  keepLastTurns?: number;
  compressionTrigger?: number;
  maxMessageChars?: number;
}

/**
 * Compress conversation history using rolling-window retention and lightweight local transforms.
 * Optionally delegates to headroom-ai when a proxy URL is configured.
 */
export async function compressHistory(
  messages: ChatMessage[],
  options: HistoryCompressorOptions = {},
): Promise<ChatMessage[]> {
  const keepSystem = options.keepSystem ?? true;
  const keepLastTurns = options.keepLastTurns ?? 4;
  const compressionTrigger = options.compressionTrigger ?? 0.6;
  const maxMessageChars = options.maxMessageChars ?? 1200;

  const estimatedTokens = estimateTokens(messages);
  const contextLimit = 128_000;
  const ratio = estimatedTokens / contextLimit;

  if (ratio < compressionTrigger) {
    return messages;
  }

  const headroomUrl = process.env.HEADROOM_URL;
  if (headroomUrl) {
    try {
      const { compress } = await import("headroom-ai");
      const result = await compress(messages, {
        baseUrl: headroomUrl,
        apiKey: process.env.HEADROOM_API_KEY,
      });
      return result.messages as ChatMessage[];
    } catch {
      // Fall through to local compression
    }
  }

  return localCompress(messages, { keepSystem, keepLastTurns, maxMessageChars });
}

function localCompress(
  messages: ChatMessage[],
  options: { keepSystem: boolean; keepLastTurns: number; maxMessageChars: number },
): ChatMessage[] {
  const systemMessages = options.keepSystem
    ? messages.filter((m) => m.role === "system")
    : [];

  const nonSystem = messages.filter((m) => m.role !== "system");
  const turns = groupTurns(nonSystem);
  const keptTurns = turns.slice(-options.keepLastTurns);
  const droppedTurns = turns.slice(0, -options.keepLastTurns);

  const summary =
    droppedTurns.length > 0
      ? [
          {
            role: "system" as const,
            content: `[TokensCache] Compressed ${droppedTurns.length} earlier turns.`,
          },
        ]
      : [];

  const compressedKept = keptTurns.flat().map((message) => compressMessage(message, options.maxMessageChars));

  return [...systemMessages, ...summary, ...compressedKept];
}

function compressMessage(message: ChatMessage, maxChars: number): ChatMessage {
  if (message.content.length <= maxChars) return message;
  const route = routeContent(message.content);
  if (route.strategy === "preserve") return message;

  const head = message.content.slice(0, Math.floor(maxChars * 0.7));
  const tail = message.content.slice(-Math.floor(maxChars * 0.2));
  return {
    ...message,
    content: `${head}\n…[truncated ${message.content.length - head.length - tail.length} chars]…\n${tail}`,
  };
}

function groupTurns(messages: ChatMessage[]): ChatMessage[][] {
  const turns: ChatMessage[][] = [];
  let current: ChatMessage[] = [];

  for (const message of messages) {
    if (message.role === "user" && current.length > 0) {
      turns.push(current);
      current = [];
    }
    current.push(message);
  }
  if (current.length > 0) turns.push(current);
  return turns;
}

function estimateTokens(messages: ChatMessage[]): number {
  const chars = messages.reduce((sum, m) => sum + m.content.length, 0);
  return Math.ceil(chars / 4);
}
