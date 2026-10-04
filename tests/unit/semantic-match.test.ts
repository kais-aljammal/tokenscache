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

describe("embeddings", () => {
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

describe("match policies", () => {
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

describe("semantic matcher", () => {
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
    expect(matcher.getStats()).toEqual({ size: 1, hits: 0, misses: 1 });
  });

  it("does not return a hit for a different provider", async () => {
    const matcher = new SemanticMatcher({
      highThreshold: 0.5,
      grayZoneMin: 0.3,
      embeddingProvider: new HashEmbeddingService(64),
    });

    const openaiRequest: ChatRequest = {
      provider: "openai",
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "What is the capital of France?" }],
    };

    await matcher.index(openaiRequest, response, "hash-openai");

    const geminiRequest: ChatRequest = {
      provider: "gemini",
      model: "gemini-2.0-flash",
      messages: openaiRequest.messages,
    };

    const miss = await matcher.findSimilar(geminiRequest);
    expect(miss).toBeNull();
    expect(matcher.getStats().misses).toBe(1);
    expect(matcher.getStats().hits).toBe(0);
  });

  it("hits a paraphrase for the same provider and model at a low threshold", async () => {
    const matcher = new SemanticMatcher({
      highThreshold: 0.5,
      grayZoneMin: 0.3,
      embeddingProvider: new HashEmbeddingService(64),
    });

    const request: ChatRequest = {
      provider: "openai",
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "What is the capital of France?" }],
    };

    await matcher.index(request, response, "hash-paraphrase");

    const paraphrase: ChatRequest = {
      ...request,
      messages: [{ role: "user", content: "What is the capital of France" }],
    };

    const hit = await matcher.findSimilar(paraphrase);
    expect(hit).not.toBeNull();
    expect(hit?.matchedHash).toBe("hash-paraphrase");
    expect(hit?.response.content).toContain("Paris");
    expect(matcher.getStats().hits).toBe(1);
    expect(matcher.getStats().misses).toBe(0);
  });

  it("delete(hash) removes a candidate", async () => {
    const matcher = new SemanticMatcher({
      embeddingProvider: new HashEmbeddingService(64),
    });

    const request: ChatRequest = {
      provider: "openai",
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "What is the capital of France?" }],
    };

    await matcher.index(request, response, "hash-delete");
    expect(matcher.size()).toBe(1);
    expect(matcher.delete("hash-delete")).toBe(true);
    expect(matcher.size()).toBe(0);
    expect(matcher.delete("hash-delete")).toBe(false);
    expect(matcher.getStats().size).toBe(0);
  });

  it("overflow evicts the least-recently-used candidate", async () => {
    const matcher = new SemanticMatcher({
      highThreshold: 0.5,
      grayZoneMin: 0.3,
      embeddingProvider: new HashEmbeddingService(64),
      maxCandidates: 2,
    });

    const makeRequest = (content: string): ChatRequest => ({
      provider: "openai",
      model: "gpt-4o-mini",
      messages: [{ role: "user", content }],
    });

    await matcher.index(makeRequest("alpha prompt one"), { ...response, id: "r-a" }, "hash-1");
    await matcher.index(makeRequest("beta prompt two"), { ...response, id: "r-b" }, "hash-2");
    expect(matcher.size()).toBe(2);

    const touch = await matcher.findSimilar(makeRequest("alpha prompt one"));
    expect(touch?.matchedHash).toBe("hash-1");

    await matcher.index(makeRequest("gamma prompt three"), { ...response, id: "r-c" }, "hash-3");

    expect(matcher.size()).toBe(2);
    expect(matcher.delete("hash-2")).toBe(false);
    expect(matcher.delete("hash-1")).toBe(true);
    expect(matcher.delete("hash-3")).toBe(true);
  });
});
