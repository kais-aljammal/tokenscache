/**
 * Mock LLM that returns real cashier code chunks and meters token usage per upstream call.
 */

import { ProviderAdapter, type ProviderAdapterConfig } from "../../src/core/providers/base.js";
import type { ChatRequest, ChatResponse, TokenUsage } from "../../src/core/types.js";
import { estimateRequestTokens, estimateTokens } from "./agent-prompts.js";

/** Code snippets returned per artifact — substantive cashier implementation. */
export const ARTIFACT_CODE: Record<string, string> = {
  product: `export interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
}

export function createProduct(id: string, name: string, price: number, stock: number): Product {
  if (price < 0 || stock < 0) throw new Error("Invalid product fields");
  return { id, name, price, stock };
}`,
  cart: `import type { Product } from "./product.js";

export interface CartLine {
  product: Product;
  quantity: number;
}

export class Cart {
  private lines: CartLine[] = [];

  add(product: Product, quantity: number): void {
    if (quantity <= 0) throw new Error("Quantity must be positive");
    const existing = this.lines.find((l) => l.product.id === product.id);
    if (existing) existing.quantity += quantity;
    else this.lines.push({ product, quantity });
  }

  remove(productId: string): void {
    this.lines = this.lines.filter((l) => l.product.id !== productId);
  }

  clear(): void { this.lines = []; }
  getItems(): readonly CartLine[] { return this.lines; }
}`,
  checkout: `import type { CartLine } from "./cart.js";

export function computeSubtotal(lines: readonly CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.product.price * l.quantity, 0);
}`,
  tax: `export function applyTax(subtotal: number, rate = 0.08): number {
  return Math.round(subtotal * rate * 100) / 100;
}`,
  payment: `export type PaymentMethod = "cash" | "card";

export interface Payment {
  method: PaymentMethod;
  amount: number;
}`,
  receipt: `import type { CartLine } from "./cart.js";

export function formatReceipt(lines: readonly CartLine[], tax: number, total: number): string {
  const rows = lines.map((l) => \`\${l.product.name} x\${l.quantity} $\${(l.product.price * l.quantity).toFixed(2)}\`);
  return ["--- RECEIPT ---", ...rows, \`Tax: $\${tax.toFixed(2)}\`, \`Total: $\${total.toFixed(2)}\`, "---------------"].join("\\n");
}`,
  inventory: `import type { Product } from "./product.js";
import type { Cart } from "./cart.js";

export function addWithStockCheck(cart: Cart, product: Product, quantity: number): void {
  const inCart = cart.getItems().find((l) => l.product.id === product.id)?.quantity ?? 0;
  if (inCart + quantity > product.stock) throw new Error(\`Insufficient stock for \${product.name}\`);
  cart.add(product, quantity);
}`,
  service: `import { Cart } from "./cart.js";
import { createProduct, type Product } from "./product.js";
import { computeSubtotal } from "./checkout.js";
import { applyTax } from "./tax.js";
import { formatReceipt } from "./receipt.js";
import { addWithStockCheck } from "./inventory.js";
import type { Payment } from "./payment.js";

export class CashierService {
  private catalog = new Map<string, Product>();
  readonly cart = new Cart();

  addProduct(p: Product): void { this.catalog.set(p.id, p); }
  addToCart(productId: string, qty: number): void {
    const p = this.catalog.get(productId);
    if (!p) throw new Error("Product not found");
    addWithStockCheck(this.cart, p, qty);
  }

  checkout(payment: Payment): string {
    const lines = this.cart.getItems();
    const subtotal = computeSubtotal(lines);
    const tax = applyTax(subtotal);
    const total = subtotal + tax;
    if (payment.amount < total) throw new Error("Insufficient payment");
    const receipt = formatReceipt(lines, tax, total);
    this.cart.clear();
    return receipt;
  }
}`,
  tests: `import { describe, it, expect } from "vitest";
import { Cart } from "./cart.js";
import { createProduct } from "./product.js";
import { computeSubtotal } from "./checkout.js";
import { applyTax } from "./tax.js";

describe("Cashier", () => {
  it("computes subtotal", () => {
    const p = createProduct("1", "Apple", 1.5, 10);
    const cart = new Cart();
    cart.add(p, 2);
    expect(computeSubtotal(cart.getItems())).toBe(3);
  });
  it("applies tax", () => {
    expect(applyTax(100, 0.08)).toBe(8);
  });
});`,
};

export interface MeterSnapshot {
  upstreamCalls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export class MeteredMockProvider extends ProviderAdapter {
  private calls = 0;
  private inputTokens = 0;
  private outputTokens = 0;

  constructor(config: ProviderAdapterConfig = {}) {
    super("mock", config);
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const artifact = (request.metadata?.artifact as string) ?? "product";
    const code = ARTIFACT_CODE[artifact] ?? "// unknown artifact";
    const input = estimateRequestTokens(request.messages);
    const output = estimateTokens(code);

    this.calls += 1;
    this.inputTokens += input;
    this.outputTokens += output;

    return {
      id: `mock-${this.calls}`,
      content: code,
      model: request.model,
      usage: { inputTokens: input, outputTokens: output },
      cached: false,
    };
  }

  getCheapestModel(currentModel: string): string {
    return currentModel;
  }

  normalizeUsage(raw: unknown): TokenUsage {
    return raw as TokenUsage;
  }

  snapshot(): MeterSnapshot {
    return {
      upstreamCalls: this.calls,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      totalTokens: this.inputTokens + this.outputTokens,
    };
  }

  reset(): void {
    this.calls = 0;
    this.inputTokens = 0;
    this.outputTokens = 0;
  }
}
