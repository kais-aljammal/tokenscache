import { buildSystemContext, type AgentTaskScenario } from "../types.js";

const artifacts = {
  bucket: `export class TokenBucket {
  private tokens: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
    initial?: number,
  ) {
    this.tokens = initial ?? capacity;
  }

  tryConsume(count = 1): boolean {
    if (this.tokens < count) return false;
    this.tokens -= count;
    return true;
  }

  refill(elapsedSec: number): void {
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.refillPerSec);
  }
}`,
  window: `export class SlidingWindowCounter {
  private timestamps: number[] = [];

  constructor(private readonly windowMs: number, private readonly maxRequests: number) {}

  allow(now = Date.now()): boolean {
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);
    if (this.timestamps.length >= this.maxRequests) return false;
    this.timestamps.push(now);
    return true;
  }
}`,
  config: `export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  burstCapacity?: number;
}

export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  windowMs: 60_000,
  maxRequests: 100,
  burstCapacity: 20,
};`,
  middleware: `import { SlidingWindowCounter } from "./window.js";
import type { RateLimitConfig } from "./config.js";

export type NextFn = () => void;

export function createRateLimitMiddleware(config: RateLimitConfig) {
  const counter = new SlidingWindowCounter(config.windowMs, config.maxRequests);
  return (_req: unknown, _res: { status: (code: number) => void }, next: NextFn): void => {
    if (!counter.allow()) throw new Error("Rate limit exceeded");
    next();
  };
}`,
  service: `import { TokenBucket } from "./bucket.js";
import { SlidingWindowCounter } from "./window.js";
import { DEFAULT_RATE_LIMIT, type RateLimitConfig } from "./config.js";
import { createRateLimitMiddleware } from "./middleware.js";

export class RateLimitService {
  private bucket: TokenBucket;
  private window: SlidingWindowCounter;

  constructor(config: RateLimitConfig = DEFAULT_RATE_LIMIT) {
    this.bucket = new TokenBucket(config.burstCapacity ?? 20, config.maxRequests / (config.windowMs / 1000));
    this.window = new SlidingWindowCounter(config.windowMs, config.maxRequests);
  }

  allowRequest(): boolean {
    return this.window.allow() && this.bucket.tryConsume();
  }

  middleware() {
    return createRateLimitMiddleware(DEFAULT_RATE_LIMIT);
  }
}`,
  tests: `import { describe, it, expect } from "vitest";
import { TokenBucket } from "./bucket.js";
import { SlidingWindowCounter } from "./window.js";

describe("Rate limiter", () => {
  it("token bucket consumes", () => {
    const b = new TokenBucket(2, 1);
    expect(b.tryConsume()).toBe(true);
    expect(b.tryConsume()).toBe(true);
    expect(b.tryConsume()).toBe(false);
  });
  it("sliding window caps requests", () => {
    const w = new SlidingWindowCounter(1000, 2);
    expect(w.allow(100)).toBe(true);
    expect(w.allow(200)).toBe(true);
    expect(w.allow(300)).toBe(false);
  });
});`,
};

export const rateLimiterScenario: AgentTaskScenario = {
  id: "rate-limiter",
  name: "HTTP Rate Limiter",
  domain: "API gateway throttling",
  systemContext: buildSystemContext("Rate Limiter", "TypeScript middleware", "logging, metrics"),
  turns: [
    { id: "t01", label: "Token bucket", userMessage: "Implement TokenBucket with tryConsume and refill.", artifact: "bucket" },
    { id: "t02", label: "Sliding window", userMessage: "SlidingWindowCounter with allow() and window pruning.", artifact: "window" },
    { id: "t03", label: "Config", userMessage: "RateLimitConfig type and DEFAULT_RATE_LIMIT constant.", artifact: "config" },
    { id: "t04", label: "Duplicate bucket", userMessage: "Implement TokenBucket with tryConsume and refill.", artifact: "bucket" },
    { id: "t05", label: "Paraphrase window", userMessage: "Track request timestamps in a rolling time window.", artifact: "window" },
    { id: "t06", label: "Middleware", userMessage: "createRateLimitMiddleware factory returning express-style handler.", artifact: "middleware" },
    { id: "t07", label: "Paraphrase config", userMessage: "Default rate limit settings: 100 req/min with burst 20.", artifact: "config" },
    { id: "t08", label: "Service", userMessage: "RateLimitService combining bucket, window, and middleware.", artifact: "service" },
    { id: "t09", label: "Duplicate window", userMessage: "SlidingWindowCounter with allow() and window pruning.", artifact: "window" },
    { id: "t10", label: "Tests", userMessage: "Vitest for token bucket and sliding window.", artifact: "tests" },
  ],
  artifacts,
  minCacheHits: 4,
  validateArtifacts(artifacts) {
    const notes: string[] = [];
    if (!artifacts.service?.includes("RateLimitService")) notes.push("Missing RateLimitService");
    if (!artifacts.bucket?.includes("TokenBucket")) notes.push("Missing TokenBucket");
    return { valid: notes.length === 0, notes };
  },
};
