import { describe, it, expect } from "vitest";
import {
  HashEmbeddingService,
  cosineSimilarity,
  embeddingToBlob,
  blobToEmbedding,
} from "../../src/core/cache/embedding.js";

describe("HashEmbeddingService", () => {
  const embedder = new HashEmbeddingService(64);

  it("embeds identical text as cosine ~ 1", async () => {
    const text = "What is the capital of France?";
    const a = await embedder.embed(text);
    const b = await embedder.embed(text);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
  });

  it("keeps small punctuation and case changes close", async () => {
    const a = await embedder.embed("What is the capital of France?");
    const b = await embedder.embed("what is the capital of france");
    expect(cosineSimilarity(a, b)).toBeGreaterThan(0.7);
  });

  it("scores unrelated strings lower than a similar pair", async () => {
    const similarA = await embedder.embed("What is the capital of France?");
    const similarB = await embedder.embed("what is the capital of france");
    const unrelatedA = await embedder.embed("Explain quantum computing");
    const unrelatedB = await embedder.embed("Recipe for chocolate cake");

    const similar = cosineSimilarity(similarA, similarB);
    const unrelated = cosineSimilarity(unrelatedA, unrelatedB);

    expect(unrelated).toBeLessThan(similar);
    expect(similar).toBeGreaterThan(0.7);
  });

  it("returns a zero vector for empty text", async () => {
    const empty = await embedder.embed("");
    const blank = await embedder.embed("   ");
    expect(empty.length).toBe(64);
    expect(blank.length).toBe(64);
    expect([...empty].every((value) => value === 0)).toBe(true);
    expect([...blank].every((value) => value === 0)).toBe(true);
  });

  it("round-trips embeddings through blob storage", async () => {
    const vec = await embedder.embed("hello world");
    const blob = embeddingToBlob(vec);
    const restored = blobToEmbedding(blob);
    expect(restored.length).toBe(vec.length);
    expect(cosineSimilarity(vec, restored)).toBeCloseTo(1, 5);
  });
});
