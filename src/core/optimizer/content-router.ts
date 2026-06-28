import { z } from "zod";

export const ContentTypeSchema = z.enum([
  "json",
  "code",
  "logs",
  "text",
  "html",
  "diff",
  "search",
  "unknown",
]);

export type ContentType = z.infer<typeof ContentTypeSchema>;

export interface ContentRoute {
  type: ContentType;
  strategy: "compress" | "preserve" | "truncate";
  priority: number;
}

const CODE_PATTERN = /\b(function|class|const|import|def |SELECT |```)/i;
const JSON_PATTERN = /^\s*[\[{]/;
const HTML_PATTERN = /<\/?[a-z][\s\S]*>/i;
const LOG_PATTERN = /\b(ERROR|WARN|INFO|DEBUG|traceback)\b/i;
const DIFF_PATTERN = /^(\+{3}|-{3}|@@)/m;

/**
 * Route message blocks to compression strategies based on content type.
 */
export function routeContent(content: string): ContentRoute {
  const trimmed = content.trim();
  if (!trimmed) {
    return { type: "unknown", strategy: "preserve", priority: 0 };
  }

  if (DIFF_PATTERN.test(trimmed)) {
    return { type: "diff", strategy: "compress", priority: 3 };
  }
  if (JSON_PATTERN.test(trimmed)) {
    return { type: "json", strategy: "compress", priority: 4 };
  }
  if (HTML_PATTERN.test(trimmed)) {
    return { type: "html", strategy: "compress", priority: 3 };
  }
  if (CODE_PATTERN.test(trimmed)) {
    return { type: "code", strategy: "preserve", priority: 5 };
  }
  if (LOG_PATTERN.test(trimmed)) {
    return { type: "logs", strategy: "truncate", priority: 2 };
  }
  if (trimmed.length > 4000) {
    return { type: "text", strategy: "compress", priority: 1 };
  }

  return { type: "text", strategy: "preserve", priority: 1 };
}

export function routeMessages(
  messages: Array<{ role: string; content: string }>,
): Array<{ index: number; route: ContentRoute }> {
  return messages.map((message, index) => ({
    index,
    route: routeContent(message.content),
  }));
}
