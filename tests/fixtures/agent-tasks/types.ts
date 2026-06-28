import type { ChatMessage } from "../../../src/core/types.js";

export interface AgentTurn {
  id: string;
  label: string;
  userMessage: string;
  artifact: string;
}

export interface AgentTaskScenario {
  id: string;
  name: string;
  domain: string;
  systemContext: string;
  turns: AgentTurn[];
  artifacts: Record<string, string>;
  /** Minimum expected cache hits (exact duplicates in turn sequence). */
  minCacheHits: number;
  validateArtifacts(artifacts: Record<string, string>): { valid: boolean; notes: string[] };
}

export function buildMessages(scenario: AgentTaskScenario, turn: AgentTurn): ChatMessage[] {
  return [
    { role: "system", content: scenario.systemContext },
    { role: "user", content: turn.userMessage },
  ];
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateRequestTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
}

export function buildSystemContext(domain: string, stack: string, modules: string): string {
  const base = `You are a senior backend engineer. Project: ${domain}.
Stack: ${stack}. Follow clean architecture.
Existing modules: ${modules}.
Tool definitions: read_file, write_file, search_codebase, run_tests (each ~400 tokens of schema).
Coding standards: explicit types, JSDoc on exports, vitest for tests.
Do not add UI unless specified. Code only.`;
  return base.repeat(3);
}
