import { describe, it, expect } from "vitest";
import {
  HashEmbeddingService,
  cosineSimilarity,
  embeddingToBlob,
  blobToEmbedding,
  normalizeVector,
} from "../../src/core/cache/embedding.js";
import { StaticThresholdPolicy } from "../../src/core/cache/match-policy/static-threshold.js";
import {
  VerifiedDecisionPolicy,
  VERIFIED_DECISION_EXPERIMENTAL,
} from "../../src/core/cache/match-policy/verified-decision.js";
import { SemanticMatcher } from "../../src/core/cache/semantic-match.js";
import type { ChatRequest, ChatResponse } from "../../src/core/types.js";

describe("Phase 3 — embeddings", () => {
  it("computes cosine similarity for identical vectors", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([1, 0, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
  });

  it("round-trips embeddings through blob storage", async () => {
    const embedder = new HashEmbeddingService(16);
    const vec = await embedder.embed("hello world");
    const blob = embeddingToBlob(vec);
    const restored = blobToEmbedding(blob);
    expect(restored.length).toBe(vec.length);
    expect(cosineSimilarity(vec, restored)).toBeCloseTo(1, 5);
  });

  it("normalizes vectors to unit length", () => {
    const vec = new Float32Array([3, 4]);
    normalizeVector(vec);
    const norm = Math.sqrt(vec[0]! ** 2 + vec[1]! ** 2);
    expect(norm).toBeCloseTo(1, 5);
  });
});

describe("Phase 3 — match policies", () => {
  it("accepts high-similarity matches via static threshold", () => {
    const policy = new StaticThresholdPolicy({ highThreshold: 0.9, grayZoneMin: 0.7 });
    expect(policy.decide(0.95)).toBe("accept");
    expect(policy.decide(0.75)).toBe("gray");
    expect(policy.decide(0.5)).toBe("reject");
  });

  it("verifies gray-zone matches in experimental policy", () => {
    expect(VERIFIED_DECISION_EXPERIMENTAL).toBe(true);
    const policy = new VerifiedDecisionPolicy({ highThreshold: 0.9, grayZoneMin: 0.7 });
    const verified = policy.verifyGrayZone("gray", {
      queryText: "deploy kubernetes cluster",
      candidateText: "deploy kubernetes service cluster",
    });
    expect(verified).toBe("accept");
  });
});

describe("Phase 3 — semantic matcher", () => {
  const response: ChatResponse = {
    id: "r1",
    content: "Paris is the capital of France.",
    model: "test",
    usage: { inputTokens: 10, outputTokens: 5 },
    cached: false,
  };

  it("finds semantically similar prompts", async () => {
    const matcher = new SemanticMatcher({
      highThreshold: 0.5,
      grayZoneMin: 0.3,
      embeddingProvider: new HashEmbeddingService(64),
    });

    const baseRequest: ChatRequest = {
      provider: "openai",
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "What is the capital of France?" }],
    };

    await matcher.index(baseRequest, response, "hash-a");

    const similarRequest: ChatRequest = {
      ...baseRequest,
      messages: [{ role: "user", content: "What is the capital of France" }],
    };

    const hit = await matcher.findSimilar(similarRequest);
    expect(hit).not.toBeNull();
    expect(hit?.response.content).toContain("Paris");
  });

  it("rejects dissimilar prompts", async () => {
    const matcher = new SemanticMatcher({
      highThreshold: 0.99,
      grayZoneMin: 0.95,
      embeddingProvider: new HashEmbeddingService(64),
    });

    const baseRequest: ChatRequest = {
      provider: "openai",
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "Explain quantum computing" }],
    };

    await matcher.index(baseRequest, response, "hash-b");

    const miss = await matcher.findSimilar({
      ...baseRequest,
      messages: [{ role: "user", content: "Recipe for chocolate cake" }],
    });

    expect(miss).toBeNull();
  });
});
