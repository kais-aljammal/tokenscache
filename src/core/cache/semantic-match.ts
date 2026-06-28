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

    for (const candidate of this.candidates.values()) {
      if (queryArtifact !== candidate.artifact) continue;
      const similarity = cosineSimilarity(queryEmbedding, candidate.embedding);
      let decision = this.policy.decide(similarity);

      if (this.verifiedPolicy && decision === "gray") {
        decision = this.verifiedPolicy.verifyGrayZone(decision, {
          queryText,
          candidateText: candidate.promptText,
        });
      }

      if (decision !== "accept") continue;

      if (!best || similarity > best.similarity) {
        best = {
          response: {
            ...candidate.response,
            cached: true,
            cacheLayer: "semantic",
          },
          similarity,
          matchedHash: candidate.hash,
        };
      }
    }

    return best;
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

  size(): number {
    return this.candidates.size;
  }

  clear(): void {
    this.candidates.clear();
  }

  private evictIfNeeded(): void {
    if (this.candidates.size <= this.maxCandidates) return;
    const overflow = this.candidates.size - this.maxCandidates;
    const keys = Array.from(this.candidates.keys()).slice(0, overflow);
    for (const key of keys) {
      this.candidates.delete(key);
    }
  }
}

export const SEMANTIC_MATCH_PHASE = 3 as const;

export type { MatchDecision };
