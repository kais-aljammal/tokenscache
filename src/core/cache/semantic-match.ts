import type { ChatRequest, ChatResponse, MatchPolicy as MatchPolicyName } from "../types.js";
import {
  type EmbeddingProvider,
  HashEmbeddingService,
  LocalEmbeddingService,
  cosineSimilarity,
  embeddingToBlob,
  blobToEmbedding,
  promptTextFromMessages,
} from "./embedding.js";
import {
  StaticThresholdPolicy,
  type MatchPolicy,
  type MatchDecision,
} from "./match-policy/static-threshold.js";
import {
  VerifiedDecisionPolicy,
  VERIFIED_DECISION_EXPERIMENTAL,
} from "./match-policy/verified-decision.js";
import { serializePrompt } from "./hash.js";

const EXACT_ENOUGH_SIMILARITY = 0.999;

export interface SemanticMatchResult {
  response: ChatResponse;
  similarity: number;
  matchedHash: string;
}

export interface SemanticCandidate {
  hash: string;
  promptText: string;
  response: ChatResponse;
  embedding: Float32Array;
  artifact?: string;
  provider: string;
  model: string;
  lastAccessedAt: number;
}

export interface SemanticMatcherStats {
  size: number;
  hits: number;
  misses: number;
}

export interface SemanticMatcherOptions {
  highThreshold?: number;
  grayZoneMin?: number;
  matchPolicy?: MatchPolicyName;
  embeddingProvider?: EmbeddingProvider;
  maxCandidates?: number;
}

/**
 * Local embedding + cosine similarity semantic cache matcher.
 */
export class SemanticMatcher {
  private readonly policy: MatchPolicy;
  private readonly verifiedPolicy?: VerifiedDecisionPolicy;
  private readonly embedder: EmbeddingProvider;
  private readonly candidates = new Map<string, SemanticCandidate>();
  private readonly maxCandidates: number;
  private hits = 0;
  private misses = 0;
  private lastStamp = 0;

  constructor(options: SemanticMatcherOptions = {}) {
    const highThreshold = options.highThreshold ?? 0.92;
    const grayZoneMin = options.grayZoneMin ?? 0.7;
    const matchPolicy = options.matchPolicy ?? "static-threshold";

    if (matchPolicy === "verified-decision" && VERIFIED_DECISION_EXPERIMENTAL) {
      this.verifiedPolicy = new VerifiedDecisionPolicy({ highThreshold, grayZoneMin });
      this.policy = this.verifiedPolicy;
    } else {
      this.policy = new StaticThresholdPolicy({ highThreshold, grayZoneMin });
    }

    this.embedder = options.embeddingProvider ?? new HashEmbeddingService();
    this.maxCandidates = options.maxCandidates ?? 10_000;
  }

  /**
   * Create a matcher with lazy-loaded transformers embeddings.
   */
  static withLocalEmbeddings(options: SemanticMatcherOptions = {}): SemanticMatcher {
    return new SemanticMatcher({
      ...options,
      embeddingProvider: options.embeddingProvider ?? new LocalEmbeddingService(),
    });
  }

  async findSimilar(request: ChatRequest): Promise<SemanticMatchResult | null> {
    const queryText = promptTextFromMessages(request.messages, { userOnly: true });
    const queryEmbedding = await this.embedder.embed(queryText);
    const queryArtifact =
      typeof request.metadata?.artifact === "string" ? request.metadata.artifact : undefined;

    let best: SemanticMatchResult | null = null;
    let bestCandidate: SemanticCandidate | null = null;

    for (const candidate of this.candidates.values()) {
      if (request.provider !== candidate.provider) continue;
      if (request.model !== candidate.model) continue;
      if (queryArtifact !== candidate.artifact) continue;

      const similarity = cosineSimilarity(queryEmbedding, candidate.embedding);

      if (similarity >= EXACT_ENOUGH_SIMILARITY) {
        this.touch(candidate);
        this.hits += 1;
        return this.toMatchResult(candidate, similarity);
      }

      let decision = this.policy.decide(similarity);

      if (this.verifiedPolicy && decision === "gray") {
        decision = this.verifiedPolicy.verifyGrayZone(decision, {
          queryText,
          candidateText: candidate.promptText,
        });
      }

      if (decision !== "accept") continue;

      if (!best || similarity > best.similarity) {
        best = this.toMatchResult(candidate, similarity);
        bestCandidate = candidate;
      }
    }

    if (best && bestCandidate) {
      this.touch(bestCandidate);
      this.hits += 1;
      return best;
    }

    this.misses += 1;
    return null;
  }

  async index(request: ChatRequest, response: ChatResponse, hash: string): Promise<void> {
    const promptText = serializePrompt(request.messages);
    const embedding = await this.embedder.embed(
      promptTextFromMessages(request.messages, { userOnly: true }),
    );

    this.candidates.set(hash, {
      hash,
      promptText,
      response,
      embedding,
      artifact:
        typeof request.metadata?.artifact === "string" ? request.metadata.artifact : undefined,
      provider: request.provider,
      model: request.model,
      lastAccessedAt: this.now(),
    });

    this.evictIfNeeded();
  }

  async embedText(text: string): Promise<Float32Array> {
    return this.embedder.embed(text);
  }

  serializeEmbedding(vec: Float32Array): Uint8Array {
    return embeddingToBlob(vec);
  }

  deserializeEmbedding(blob: Uint8Array): Float32Array {
    return blobToEmbedding(blob);
  }

  delete(hash: string): boolean {
    return this.candidates.delete(hash);
  }

  size(): number {
    return this.candidates.size;
  }

  clear(): void {
    this.candidates.clear();
  }

  getStats(): SemanticMatcherStats {
    return {
      size: this.candidates.size,
      hits: this.hits,
      misses: this.misses,
    };
  }

  private toMatchResult(candidate: SemanticCandidate, similarity: number): SemanticMatchResult {
    return {
      response: {
        ...candidate.response,
        cached: true,
        cacheLayer: "semantic",
      },
      similarity,
      matchedHash: candidate.hash,
    };
  }

  private touch(candidate: SemanticCandidate): void {
    candidate.lastAccessedAt = this.now();
  }

  private now(): number {
    const t = Date.now();
    this.lastStamp = t <= this.lastStamp ? this.lastStamp + 1 : t;
    return this.lastStamp;
  }

  private evictIfNeeded(): void {
    if (this.candidates.size <= this.maxCandidates) return;
    const overflow = this.candidates.size - this.maxCandidates;
    const evictKeys = Array.from(this.candidates.values())
      .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt)
      .slice(0, overflow)
      .map((candidate) => candidate.hash);
    for (const key of evictKeys) {
      this.candidates.delete(key);
    }
  }
}

export type { MatchDecision };
