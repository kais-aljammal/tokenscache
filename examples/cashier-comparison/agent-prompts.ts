/**
 * Shared agent prompt sequence — simulates a coding agent building a cashier system.
 * Includes repeated context, exact duplicates, and semantic paraphrases (realistic waste).
 */

import type { ChatMessage } from "../../src/core/types.js";

/** Bloated system context mimicking agent tool schemas + project docs (~high token cost). */
export const SYSTEM_CONTEXT = `You are a senior backend engineer. Project: retail POS.
Stack: TypeScript, no UI. Follow clean architecture.
Existing modules: auth (unused), logging, config loader.
Tool definitions: read_file, write_file, search_codebase, run_tests (each ~400 tokens of schema).
Coding standards: explicit types, JSDoc on exports, vitest for tests.
Repository layout: src/domain, src/services, src/index.ts
Do not add UI. Code only.`.repeat(3); // inflate context deliberately

export interface AgentTurn {
  id: string;
  label: string;
  userMessage: string;
  /** Which code artifact this turn contributes */
  artifact: string;
}

export const AGENT_TURNS: AgentTurn[] = [
  {
    id: "t01",
    label: "Define Product model",
    userMessage: "Create a Product type with id, name, price, and stock quantity.",
    artifact: "product",
  },
  {
    id: "t02",
    label: "Define Cart",
    userMessage: "Add a Cart class that holds line items with add, remove, and clear.",
    artifact: "cart",
  },
  {
    id: "t03",
    label: "Checkout totals",
    userMessage: "Implement checkout that computes subtotal from cart line items.",
    artifact: "checkout",
  },
  {
    id: "t04",
    label: "Duplicate — Product model again",
    userMessage: "Create a Product type with id, name, price, and stock quantity.",
    artifact: "product",
  },
  {
    id: "t05",
    label: "Semantic paraphrase — Cart",
    userMessage: "Build a shopping cart class supporting add/remove/clear for line items.",
    artifact: "cart",
  },
  {
    id: "t06",
    label: "Sales tax",
    userMessage: "Add configurable sales tax rate to checkout (default 8%).",
    artifact: "tax",
  },
  {
    id: "t07",
    label: "Paraphrase — tax",
    userMessage: "Apply a default 8% sales tax on checkout totals.",
    artifact: "tax",
  },
  {
    id: "t08",
    label: "Payment methods",
    userMessage: "Support cash and card payment types on checkout.",
    artifact: "payment",
  },
  {
    id: "t09",
    label: "Receipt",
    userMessage: "Generate a text receipt with line items, tax, and total.",
    artifact: "receipt",
  },
  {
    id: "t10",
    label: "Duplicate — checkout",
    userMessage: "Implement checkout that computes subtotal from cart line items.",
    artifact: "checkout",
  },
  {
    id: "t11",
    label: "Inventory guard",
    userMessage: "Prevent adding more items to cart than available stock.",
    artifact: "inventory",
  },
  {
    id: "t12",
    label: "Paraphrase — inventory",
    userMessage: "Block cart adds when requested quantity exceeds product stock.",
    artifact: "inventory",
  },
  {
    id: "t13",
    label: "Cashier service",
    userMessage: "Create CashierService orchestrating catalog, cart, and checkout.",
    artifact: "service",
  },
  {
    id: "t14",
    label: "Duplicate — receipt",
    userMessage: "Generate a text receipt with line items, tax, and total.",
    artifact: "receipt",
  },
  {
    id: "t15",
    label: "Unit tests",
    userMessage: "Write vitest tests for cart totals and tax calculation.",
    artifact: "tests",
  },
];

export function buildMessages(turn: AgentTurn): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM_CONTEXT },
    { role: "user", content: turn.userMessage },
  ];
}

/** Rough token estimate (chars / 4) — matches how mock provider bills. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateRequestTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
}
