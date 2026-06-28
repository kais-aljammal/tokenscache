import type { ChatMessage } from "../types.js";

export interface OutputShaperOptions {
  triggerRatio?: number;
  holdoutRatio?: number;
  maxChars?: number;
}

/**
 * Shape assistant outputs when remaining budget ratio drops below trigger.
 */
export function shapeOutput(
  messages: ChatMessage[],
  options: OutputShaperOptions = {},
): ChatMessage[] {
  const triggerRatio = options.triggerRatio ?? 0.25;
  const holdoutRatio = options.holdoutRatio ?? 0.1;
  const maxChars = options.maxChars ?? 2000;

  const budgetRatio = estimateBudgetRatio(messages);
  if (budgetRatio > triggerRatio) return messages;

  const holdoutCount = Math.max(1, Math.floor(messages.length * holdoutRatio));
  const holdoutStart = messages.length - holdoutCount;

  return messages.map((message, index) => {
    if (message.role !== "assistant") return message;
    if (index >= holdoutStart) return message;
    if (message.content.length <= maxChars) return message;

    return {
      ...message,
      content: `${message.content.slice(0, maxChars)}\n…[output shaped by TokensCache]`,
    };
  });
}

function estimateBudgetRatio(messages: ChatMessage[]): number {
  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  const limitChars = 100_000;
  return 1 - totalChars / limitChars;
}
