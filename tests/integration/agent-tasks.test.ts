import { describe, it, expect } from "vitest";
import { ALL_AGENT_TASKS } from "../fixtures/agent-tasks/index.js";
import {
  runWithTokenGuard,
  runWithoutTokenGuard,
  artifactsIdentical,
} from "../helpers/agent-task-runner.js";

describe("Agent task scenarios — TokenGuard proof suite", () => {
  it("defines 10 distinct coding agent tasks", () => {
    expect(ALL_AGENT_TASKS).toHaveLength(10);
    const ids = ALL_AGENT_TASKS.map((t) => t.id);
    expect(new Set(ids).size).toBe(10);
    for (const task of ALL_AGENT_TASKS) {
      expect(task.turns.length).toBeGreaterThanOrEqual(10);
      expect(Object.keys(task.artifacts).length).toBeGreaterThanOrEqual(5);
    }
  });

  describe.each(ALL_AGENT_TASKS)("$name ($id)", (scenario) => {
    it("produces complete, valid artifacts", async () => {
      const result = await runWithoutTokenGuard(scenario);
      const validation = scenario.validateArtifacts(result.artifacts);
      expect(validation.valid, validation.notes.join("; ")).toBe(true);
      expect(result.upstreamCalls).toBe(scenario.turns.length);
    });

    it("reduces upstream LLM calls via cache", async () => {
      const withTg = await runWithTokenGuard(scenario);
      const withoutTg = await runWithoutTokenGuard(scenario);

      expect(withTg.upstreamCalls).toBeLessThan(withoutTg.upstreamCalls);
      expect(withTg.cacheHits).toBeGreaterThanOrEqual(scenario.minCacheHits);
      expect(withTg.totalTokens).toBeLessThan(withoutTg.totalTokens);

      const callsSaved = withoutTg.upstreamCalls - withTg.upstreamCalls;
      expect(callsSaved).toBeGreaterThan(0);
    });

    it("returns identical output with and without TokenGuard", async () => {
      const withTg = await runWithTokenGuard(scenario);
      const withoutTg = await runWithoutTokenGuard(scenario);

      expect(artifactsIdentical(withTg.artifacts, withoutTg.artifacts)).toBe(true);

      for (const [artifact, code] of Object.entries(withoutTg.artifacts)) {
        expect(withTg.artifacts[artifact]).toBe(code);
        expect(code.length).toBeGreaterThan(20);
      }
    });

    it("achieves meaningful token savings (>20%)", async () => {
      const withTg = await runWithTokenGuard(scenario);
      const withoutTg = await runWithoutTokenGuard(scenario);

      const savedPct =
        withoutTg.totalTokens > 0
          ? ((withoutTg.totalTokens - withTg.totalTokens) / withoutTg.totalTokens) * 100
          : 0;

      expect(savedPct).toBeGreaterThan(20);
    });
  });

  it("aggregate savings across all 10 tasks", async () => {
    let totalWith = 0;
    let totalWithout = 0;
    let totalHits = 0;
    let totalCallsSaved = 0;

    for (const scenario of ALL_AGENT_TASKS) {
      const withTg = await runWithTokenGuard(scenario);
      const withoutTg = await runWithoutTokenGuard(scenario);
      totalWith += withTg.totalTokens;
      totalWithout += withoutTg.totalTokens;
      totalHits += withTg.cacheHits;
      totalCallsSaved += withoutTg.upstreamCalls - withTg.upstreamCalls;
    }

    const aggregatePct =
      totalWithout > 0 ? ((totalWithout - totalWith) / totalWithout) * 100 : 0;

    expect(totalHits).toBeGreaterThan(35);
    expect(totalCallsSaved).toBeGreaterThan(35);
    expect(aggregatePct).toBeGreaterThan(25);
  });
});

describe("Agent task scenarios — complex multi-turn patterns", () => {
  it("cashier task has duplicates and paraphrases across 15 turns", () => {
    const cashier = ALL_AGENT_TASKS.find((t) => t.id === "cashier-pos")!;
    const messages = cashier.turns.map((t) => t.userMessage);
    const duplicates = messages.filter((m, i) => messages.indexOf(m) !== i);
    expect(duplicates.length).toBeGreaterThanOrEqual(3);
    expect(cashier.turns.length).toBe(15);
  });

  it("auth-jwt task builds layered security modules", async () => {
    const auth = ALL_AGENT_TASKS.find((t) => t.id === "auth-jwt")!;
    const result = await runWithTokenGuard(auth);

    expect(result.artifacts.hash).toContain("verifyPassword");
    expect(result.artifacts.token).toContain("signToken");
    expect(result.artifacts.refresh).toContain("RefreshTokenStore");
    expect(result.artifacts.service).toContain("AuthService");
    expect(result.cacheHits).toBeGreaterThanOrEqual(3);
  });

  it("inventory-wms task wires transfer + ledger + reorder", async () => {
    const wms = ALL_AGENT_TASKS.find((t) => t.id === "inventory-wms")!;
    const result = await runWithTokenGuard(wms);

    expect(result.artifacts.transfer).toContain("transferStock");
    expect(result.artifacts.ledger).toContain("StockLedger");
    expect(result.artifacts.service).toContain("reorderAlerts");
  });

  it("event-scheduler detects conflicts before booking", async () => {
    const sched = ALL_AGENT_TASKS.find((t) => t.id === "event-scheduler")!;
    const result = await runWithoutTokenGuard(sched);

    expect(result.artifacts.conflicts).toContain("hasConflict");
    expect(result.artifacts.calendar).toContain("findConflicts");
    expect(result.artifacts.service).toContain("expandRecurring");
  });
});
