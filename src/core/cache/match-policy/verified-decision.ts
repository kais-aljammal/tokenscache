import type { MatchDecision, MatchPolicy } from "./static-threshold.js";
import { StaticThresholdPolicy, type StaticThresholdConfig } from "./static-threshold.js";

export const VERIFIED_DECISION_EXPERIMENTAL = true as const;

export interface VerifiedDecisionConfig extends StaticThresholdConfig {
  /** Minimum token overlap ratio required to accept gray-zone matches. */
  overlapThreshold?: number;
}

export interface VerificationContext {
  queryText: string;
  candidateText: string;
}

/**
 * v1.1 experimental policy — patterns inspired by vCache VerifiedDecision (paper only, no code port).
 * Gray-zone matches require lexical overlap verification before acceptance.
 */
export class VerifiedDecisionPolicy implements MatchPolicy {
  private readonly base: StaticThresholdPolicy;
  private readonly overlapThreshold: number;
  private readonly enabled: boolean;

  constructor(config: Partial<VerifiedDecisionConfig> = {}, experimental = VERIFIED_DECISION_EXPERIMENTAL) {
    this.base = new StaticThresholdPolicy(config);
    this.overlapThreshold = config.overlapThreshold ?? 0.35;
    this.enabled = experimental;
  }

  decide(similarity: number): MatchDecision {
    if (!this.enabled) {
      return this.base.decide(similarity);
    }

    const baseDecision = this.base.decide(similarity);
    if (baseDecision !== "gray") return baseDecision;
    return "gray";
  }

  /**
   * Resolve gray-zone candidates with overlap verification.
   */
  verifyGrayZone(decision: MatchDecision, context: VerificationContext): MatchDecision {
    if (!this.enabled || decision !== "gray") return decision;
    const overlap = tokenOverlapRatio(context.queryText, context.candidateText);
    return overlap >= this.overlapThreshold ? "accept" : "reject";
  }
}

function tokenOverlapRatio(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let shared = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) shared++;
  }
  return shared / Math.min(tokensA.size, tokensB.size);
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2),
  );
}
