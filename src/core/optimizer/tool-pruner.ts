import type { ChatMessage } from "../types.js";

export interface ToolPrunerOptions {
  maxTools?: number;
  minRelevanceScore?: number;
}

interface ToolLike {
  type?: string;
  function?: { name?: string; description?: string };
  name?: string;
  description?: string;
}

/**
 * Prune tool definitions to those most relevant to the current user query.
 * Pattern inspired by token-optimizer compaction timing (patterns only).
 */
export function pruneTools(
  tools: unknown[] | undefined,
  messages: ChatMessage[],
  options: ToolPrunerOptions = {},
): unknown[] | undefined {
  if (!tools || tools.length === 0) return tools;

  const maxTools = options.maxTools ?? 8;
  const minRelevanceScore = options.minRelevanceScore ?? 0.1;
  const query = extractLatestUserQuery(messages);
  if (!query) return tools.slice(0, maxTools);

  const queryTokens = tokenize(query);

  const scored = tools.map((tool) => {
    const parsed = tool as ToolLike;
    const name = parsed.function?.name ?? parsed.name ?? "";
    const description = parsed.function?.description ?? parsed.description ?? "";
    const corpus = `${name} ${description}`.toLowerCase();
    const score = relevanceScore(queryTokens, tokenize(corpus));
    return { tool, score };
  });

  const filtered = scored
    .filter((s) => s.score >= minRelevanceScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxTools)
    .map((s) => s.tool);

  return filtered.length > 0 ? filtered : tools.slice(0, maxTools);
}

function extractLatestUserQuery(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") return messages[i]!.content;
  }
  return "";
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .filter((t) => t.length > 1),
  );
}

function relevanceScore(query: Set<string>, corpus: Set<string>): number {
  if (query.size === 0 || corpus.size === 0) return 0;
  let hits = 0;
  for (const token of query) {
    if (corpus.has(token)) hits++;
  }
  return hits / query.size;
}
