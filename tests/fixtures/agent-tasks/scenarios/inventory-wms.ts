import { buildSystemContext, type AgentTaskScenario } from "../types.js";

const artifacts = {
  warehouse: `export interface Warehouse {
  id: string;
  name: string;
  location: string;
}

export function createWarehouse(name: string, location: string): Warehouse {
  return { id: crypto.randomUUID(), name, location };
}`,
  stock: `export interface StockLevel {
  sku: string;
  warehouseId: string;
  quantity: number;
  reorderPoint: number;
}

export function needsReorder(level: StockLevel): boolean {
  return level.quantity <= level.reorderPoint;
}`,
  transfer: `import type { StockLevel } from "./stock.js";

export function transferStock(
  from: StockLevel,
  to: StockLevel,
  qty: number,
): { from: StockLevel; to: StockLevel } {
  if (from.quantity < qty) throw new Error("Insufficient stock");
  if (from.sku !== to.sku) throw new Error("SKU mismatch");
  return {
    from: { ...from, quantity: from.quantity - qty },
    to: { ...to, quantity: to.quantity + qty },
  };
}`,
  ledger: `import type { StockLevel } from "./stock.js";

export interface StockMovement {
  sku: string;
  warehouseId: string;
  delta: number;
  reason: string;
  at: Date;
}

export class StockLedger {
  private movements: StockMovement[] = [];

  record(sku: string, warehouseId: string, delta: number, reason: string): void {
    this.movements.push({ sku, warehouseId, delta, reason, at: new Date() });
  }

  history(sku: string): StockMovement[] {
    return this.movements.filter((m) => m.sku === sku);
  }
}`,
  service: `import { createWarehouse, type Warehouse } from "./warehouse.js";
import type { StockLevel } from "./stock.js";
import { needsReorder, type StockLevel as Level } from "./stock.js";
import { transferStock } from "./transfer.js";
import { StockLedger } from "./ledger.js";

export class InventoryService {
  private warehouses = new Map<string, Warehouse>();
  private levels = new Map<string, StockLevel>();
  private ledger = new StockLedger();

  registerWarehouse(name: string, location: string): Warehouse {
    const wh = createWarehouse(name, location);
    this.warehouses.set(wh.id, wh);
    return wh;
  }

  setLevel(level: Level): void {
    this.levels.set(\`\${level.warehouseId}:\${level.sku}\`, level);
  }

  transfer(fromId: string, toId: string, sku: string, qty: number): void {
    const from = this.levels.get(\`\${fromId}:\${sku}\`)!;
    const to = this.levels.get(\`\${toId}:\${sku}\`)!;
    const result = transferStock(from, to, qty);
    this.levels.set(\`\${fromId}:\${sku}\`, result.from);
    this.levels.set(\`\${toId}:\${sku}\`, result.to);
    this.ledger.record(sku, fromId, -qty, "transfer-out");
    this.ledger.record(sku, toId, qty, "transfer-in");
  }

  reorderAlerts(): StockLevel[] {
    return [...this.levels.values()].filter(needsReorder);
  }
}`,
  tests: `import { describe, it, expect } from "vitest";
import { needsReorder } from "./stock.js";
import { transferStock } from "./transfer.js";

describe("Inventory WMS", () => {
  it("flags reorder", () => {
    expect(needsReorder({ sku: "A", warehouseId: "w1", quantity: 5, reorderPoint: 10 })).toBe(true);
  });
  it("transfers stock", () => {
    const from = { sku: "A", warehouseId: "w1", quantity: 20, reorderPoint: 5 };
    const to = { sku: "A", warehouseId: "w2", quantity: 0, reorderPoint: 5 };
    const result = transferStock(from, to, 8);
    expect(result.from.quantity).toBe(12);
    expect(result.to.quantity).toBe(8);
  });
});`,
};

export const inventoryWmsScenario: AgentTaskScenario = {
  id: "inventory-wms",
  name: "Warehouse Inventory (WMS)",
  domain: "Multi-warehouse stock management",
  systemContext: buildSystemContext("Inventory WMS", "TypeScript", "barcode stub, audit log"),
  turns: [
    { id: "t01", label: "Warehouse model", userMessage: "Warehouse type and createWarehouse factory.", artifact: "warehouse" },
    { id: "t02", label: "Stock levels", userMessage: "StockLevel with reorderPoint and needsReorder.", artifact: "stock" },
    { id: "t03", label: "Transfers", userMessage: "transferStock between warehouses with SKU check.", artifact: "transfer" },
    { id: "t04", label: "Duplicate warehouse", userMessage: "Warehouse type and createWarehouse factory.", artifact: "warehouse" },
    { id: "t05", label: "Paraphrase stock", userMessage: "Track per-SKU quantity and reorder thresholds.", artifact: "stock" },
    { id: "t06", label: "Movement ledger", userMessage: "StockLedger records deltas with reason and timestamp.", artifact: "ledger" },
    { id: "t07", label: "Paraphrase transfer", userMessage: "Move inventory quantity between two warehouse records.", artifact: "transfer" },
    { id: "t08", label: "Inventory service", userMessage: "InventoryService for warehouses, transfers, reorder alerts.", artifact: "service" },
    { id: "t09", label: "Duplicate stock", userMessage: "StockLevel with reorderPoint and needsReorder.", artifact: "stock" },
    { id: "t10", label: "Tests", userMessage: "Vitest for reorder flag and stock transfer.", artifact: "tests" },
  ],
  artifacts,
  minCacheHits: 4,
  validateArtifacts(artifacts) {
    const notes: string[] = [];
    if (!artifacts.service?.includes("InventoryService")) notes.push("Missing InventoryService");
    if (!artifacts.transfer?.includes("transferStock")) notes.push("Missing transferStock");
    return { valid: notes.length === 0, notes };
  },
};
