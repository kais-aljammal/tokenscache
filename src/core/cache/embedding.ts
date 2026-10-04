/**
 * Local embedding service — lazy-loads @huggingface/transformers feature-extraction pipeline.
 */

export const DEFAULT_EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";
export const DEFAULT_EMBEDDING_DIMENSIONS = 384;

export interface EmbeddingProvider {
  readonly dimensions: number;
  embed(text: string): Promise<Float32Array>;
}

type FeatureExtractionPipeline = (
  text: string,
  options?: { pooling?: string; normalize?: boolean },
) => Promise<{ data: Float32Array }>;

let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

async function loadPipeline(model: string): Promise<FeatureExtractionPipeline> {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const transformers = (await import("@huggingface/transformers")) as {
        pipeline: (
          task: string,
          model: string,
          options?: Record<string, unknown>,
        ) => Promise<FeatureExtractionPipeline>;
      };
      return transformers.pipeline("feature-extraction", model, { dtype: "fp32" });
    })();
  }
  return pipelinePromise;
}

export interface LocalEmbeddingOptions {
  model?: string;
  dimensions?: number;
}

/**
 * Production embedding provider with lazy transformers.js load.
 */
export class LocalEmbeddingService implements EmbeddingProvider {
  readonly dimensions: number;
  private readonly model: string;

  constructor(options: LocalEmbeddingOptions = {}) {
    this.model = options.model ?? DEFAULT_EMBEDDING_MODEL;
    this.dimensions = options.dimensions ?? DEFAULT_EMBEDDING_DIMENSIONS;
  }

  async embed(text: string): Promise<Float32Array> {
    const normalized = text.trim().replace(/\s+/g, " ");
    if (!normalized) {
      return new Float32Array(this.dimensions);
    }

    const extractor = await loadPipeline(this.model);
    const output = await extractor(normalized, { pooling: "mean", normalize: true });
    return output.data;
  }
}

function hashFeatureIndex(feature: string, dimensions: number): number {
  let hash = 2166136261;
  for (let i = 0; i < feature.length; i++) {
    hash ^= feature.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % dimensions;
}

function addHashedFeature(vec: Float32Array, feature: string, weight: number): void {
  vec[hashFeatureIndex(feature, vec.length)] += weight;
}

/**
 * Deterministic lightweight embedder for tests and offline fallback.
 * Hashed character + word unigrams/bigrams keep small edits close and
 * raise paraphrase overlap above unrelated text.
 */
export class HashEmbeddingService implements EmbeddingProvider {
  readonly dimensions: number;

  constructor(dimensions = DEFAULT_EMBEDDING_DIMENSIONS) {
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<Float32Array> {
    const dims = this.dimensions;
    const vec = new Float32Array(dims);
    const normalized = text.trim().toLowerCase();
    if (!normalized) {
      return vec;
    }

    const charVec = new Float32Array(dims);
    const wordVec = new Float32Array(dims);

    for (let i = 0; i < normalized.length; i++) {
      addHashedFeature(charVec, `u:${normalized.charAt(i)}`, 1);
      if (i + 1 < normalized.length) {
        addHashedFeature(charVec, `b:${normalized.charAt(i)}${normalized.charAt(i + 1)}`, 1);
      }
    }

    const words = normalized.split(/[^a-z0-9]+/).filter(Boolean);
    for (let i = 0; i < words.length; i++) {
      addHashedFeature(wordVec, `w:${words[i]}`, 1);
      if (i + 1 < words.length) {
        addHashedFeature(wordVec, `p:${words[i]}_${words[i + 1]}`, 1);
      }
    }

    normalizeVector(charVec);
    normalizeVector(wordVec);

    for (let i = 0; i < dims; i++) {
      vec[i] = 0.4 * charVec[i]! + 0.6 * wordVec[i]!;
    }
    return normalizeVector(vec);
  }
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error("[TokensCache] Embedding dimension mismatch");
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function normalizeVector(vec: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < vec.length; i++) {
    norm += vec[i]! * vec[i]!;
  }
  if (norm === 0) return vec;
  const scale = 1 / Math.sqrt(norm);
  for (let i = 0; i < vec.length; i++) {
    vec[i] = vec[i]! * scale;
  }
  return vec;
}

export function embeddingToBlob(vec: Float32Array): Uint8Array {
  return new Uint8Array(vec.buffer.slice(vec.byteOffset, vec.byteOffset + vec.byteLength));
}

export function blobToEmbedding(blob: Uint8Array): Float32Array {
  const copy = blob.slice();
  return new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4);
}

export function promptTextFromMessages(
  messages: Array<{ role: string; content: string }>,
  options?: { userOnly?: boolean },
): string {
  if (options?.userOnly) {
    const user = [...messages].reverse().find((m) => m.role === "user");
    return user?.content ?? "";
  }
  return messages.map((m) => `${m.role}: ${m.content}`).join("\n");
}
