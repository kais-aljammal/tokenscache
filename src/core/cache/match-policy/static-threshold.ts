import { z } from "zod";

export const StaticThresholdConfigSchema = z.object({
  highThreshold: z.number().min(0).max(1).default(0.92),
  grayZoneMin: z.number().min(0).max(1).default(0.7),
});

export type StaticThresholdConfig = z.infer<typeof StaticThresholdConfigSchema>;

export type MatchDecision = "accept" | "reject" | "gray";

export interface MatchPolicy {
  decide(similarity: number): MatchDecision;
}

/**
 * v1.0 default match policy — cosine similarity thresholds.
 */
export class StaticThresholdPolicy implements MatchPolicy {
  private readonly highThreshold: number;
  private readonly grayZoneMin: number;

  constructor(config: Partial<StaticThresholdConfig> = {}) {
    const parsed = StaticThresholdConfigSchema.parse(config);
    this.highThreshold = parsed.highThreshold;
    this.grayZoneMin = parsed.grayZoneMin;

    if (this.grayZoneMin > this.highThreshold) {
      throw new Error("[TokensCache] grayZoneMin must be <= highThreshold");
    }
  }

  decide(similarity: number): MatchDecision {
    if (similarity >= this.highThreshold) return "accept";
    if (similarity >= this.grayZoneMin) return "gray";
    return "reject";
  }
}

export const STATIC_THRESHOLD_PHASE = 3 as const;
