import { describe, it, expect } from "vitest";
import {
  sanitizeCacheKey,
  isL2EntryExpired,
  resolveL2ExpiresAt,
  evaluateL2Entry,
  type L2CacheEntry,
} from "../../src/core/cache/l2-browser.js";

const VALID_HASH = "a".repeat(64);

function entry(overrides: Partial<L2CacheEntry> = {}): L2CacheEntry {
  return {
    hash: VALID_HASH,
    response: "{}",
    provider: "openai",
    model: "gpt-4o",
    createdAt: 1_000,
    lastAccessedAt: 1_000,
    sizeBytes: 2,
    ...overrides,
  };
}

describe("sanitizeCacheKey", () => {
  it("accepts valid SHA-256 hex keys and lowercases them", () => {
    const upper = "B".repeat(64);
    expect(sanitizeCacheKey(upper)).toBe("b".repeat(64));
    expect(sanitizeCacheKey(VALID_HASH)).toBe(VALID_HASH);
  });

  it("rejects invalid keys (XSS/injection prevention)", () => {
    expect(() => sanitizeCacheKey("<script>alert(1)</script>")).toThrow("Invalid cache key");
    expect(() => sanitizeCacheKey("not-a-hash")).toThrow("Invalid cache key");
    expect(() => sanitizeCacheKey("ab".repeat(16))).toThrow("Invalid cache key");
  });
});

describe("isL2EntryExpired", () => {
  it("treats missing expiresAt as live", () => {
    expect(isL2EntryExpired(entry(), 9_999)).toBe(false);
  });

  it("is live before expiresAt and expired at or after it", () => {
    const withTtl = entry({ expiresAt: 5_000 });
    expect(isL2EntryExpired(withTtl, 4_999)).toBe(false);
    expect(isL2EntryExpired(withTtl, 5_000)).toBe(true);
    expect(isL2EntryExpired(withTtl, 5_001)).toBe(true);
  });
});

describe("resolveL2ExpiresAt", () => {
  it("omits expiresAt when neither ttl is provided", () => {
    expect(resolveL2ExpiresAt(1_000)).toBeUndefined();
    expect(resolveL2ExpiresAt(1_000, undefined, undefined)).toBeUndefined();
  });

  it("uses per-call ttl, falling back to defaultTtlMs", () => {
    expect(resolveL2ExpiresAt(1_000, 250)).toBe(1_250);
    expect(resolveL2ExpiresAt(1_000, undefined, 400)).toBe(1_400);
    expect(resolveL2ExpiresAt(1_000, 50, 400)).toBe(1_050);
  });
});

describe("evaluateL2Entry", () => {
  const now = 10_000;

  it("returns miss when no entry exists", () => {
    expect(evaluateL2Entry(undefined, now)).toBe("miss");
  });

  it("returns expired before checking provider/model filter", () => {
    const expired = entry({ expiresAt: now });
    expect(evaluateL2Entry(expired, now)).toBe("expired");
    expect(evaluateL2Entry(expired, now, { provider: "anthropic", model: "other" })).toBe("expired");
  });

  it("returns mismatch when filter provider or model differs (does not imply delete)", () => {
    const live = entry({ expiresAt: now + 1 });
    expect(evaluateL2Entry(live, now, { provider: "anthropic" })).toBe("mismatch");
    expect(evaluateL2Entry(live, now, { model: "claude" })).toBe("mismatch");
    expect(evaluateL2Entry(live, now, { provider: "openai", model: "claude" })).toBe("mismatch");
  });

  it("returns hit for a live entry with no filter or a matching filter", () => {
    const live = entry();
    expect(evaluateL2Entry(live, now)).toBe("hit");
    expect(evaluateL2Entry(live, now, {})).toBe("hit");
    expect(evaluateL2Entry(live, now, { provider: "openai" })).toBe("hit");
    expect(evaluateL2Entry(live, now, { model: "gpt-4o" })).toBe("hit");
    expect(evaluateL2Entry(live, now, { provider: "openai", model: "gpt-4o" })).toBe("hit");
  });
});
