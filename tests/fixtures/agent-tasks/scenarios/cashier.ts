import { AGENT_TURNS, SYSTEM_CONTEXT } from "../../../../examples/cashier-comparison/agent-prompts.js";
import { ARTIFACT_CODE } from "../../../../examples/cashier-comparison/mock-llm.js";
import type { AgentTaskScenario } from "../types.js";

export const cashierScenario: AgentTaskScenario = {
  id: "cashier-pos",
  name: "Retail POS / Cashier",
  domain: "Point-of-sale checkout system",
  systemContext: SYSTEM_CONTEXT,
  turns: AGENT_TURNS.map((t) => ({
    id: t.id,
    label: t.label,
    userMessage: t.userMessage,
    artifact: t.artifact,
  })),
  artifacts: ARTIFACT_CODE,
  minCacheHits: 6,
  validateArtifacts(artifacts) {
    const notes: string[] = [];
    const required = ["product", "cart", "checkout", "service"];
    for (const key of required) {
      if (!artifacts[key]?.includes("export")) notes.push(`Missing export in ${key}`);
    }
    if (!artifacts.service?.includes("CashierService")) notes.push("Missing CashierService");
    if (!artifacts.tests?.includes("describe")) notes.push("Missing vitest tests");
    return { valid: notes.length === 0, notes };
  },
};
