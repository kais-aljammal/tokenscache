import { randomUUID } from "node:crypto";
import type { DatabaseAdapter } from "../db/schema.js";
import type { ChatRequest, ChatResponse } from "../types.js";
import { serializePrompt } from "./hash.js";
import {
  type EmbeddingProvider,
  HashEmbeddingService,
  blobToEmbedding,
  embeddingToBlob,
  promptTextFromMessages,
} from "./embedding.js";

export interface L3LocalCacheOptions {
  adapter: DatabaseAdapter;
  maxEntries?: number;
  embeddingProvider?: EmbeddingProvider;
}

interface AnnIndex {
  add(key: number, vector: Float32Array): void;
  search(vector: Float32Array, count: number): { keys: bigint[]; distances: number[] };
  size(): number;
  remove(key: number): void;
  clear(): void;
}

/**
 * Brute-force ANN fallback when usearch native module is unavailable.
 */
class LinearAnnIndex implements AnnIndex {
  private readonly vectors = new Map<number, Float32Array>();
  private readonly dimensions: number;

  constructor(dimensions: number) {
    this.dimensions = dimensions;
  }

  add(key: number, vector: Float32Array): void {
    if (vector.length !== this.dimensions) {
      throw new Error("[TokenGuard] ANN dimension mismatch");
    }
    this.vectors.set(key, vector);
  }

  search(vector: Float32Array, count: number): { keys: bigint[]; distances: number[] } {
    const scored: Array<{ key: number; distance: number }> = [];
    for (const [key, candidate] of this.vectors) {
      scored.push({ key, distance: 1 - cosineDistance(vector, candidate) });
    }
    scored.sort((a, b) => a.distance - b.distance);
    const top = scored.slice(0, count);
    return {
      keys: top.map((t) => BigInt(t.key)),
      distances: top.map((t) => t.distance),
    };
  }

  size(): number {
    return this.vectors.size;
  }

  remove(key: number): void {
    this.vectors.delete(key);
  }

  clear(): void {
    this.vectors.clear();
  }
}

function cosineDistance(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 1;
  return 1 - dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function createAnnIndex(dimensions: number): Promise<AnnIndex> {
  try {
    const usearch = await import("usearch");
    const Index = usearch.Index ?? usearch.default?.Index;
    if (!Index) throw new Error("usearch Index export missing");

    const index = new Index({
      metric: "cos",
      connectivity: 16,
      dimensions,
    });

    return {
      add(key, vector) {
        index.add(BigInt(key), vector);
      },
      search(vector, count) {
        const result = index.search(vector, count);
        return {
          keys: result.keys ?? [],
          distances: result.distances ?? [],
        };
      },
      size() {
        return index.size();
      },
      remove(key) {
        index.remove(BigInt(key));
      },
      clear() {
        index.reset?.();
      },
    };
  } catch {
    return new LinearAnnIndex(dimensions);
  }
}

/**
 * L3 persistent cache — SQLite (sql.js adapter) + usearch ANN with embedding BLOBs.
 */
export class L3LocalCache {
  private readonly adapter: DatabaseAdapter;
  private readonly maxEntries: number;
  private readonly embedder: EmbeddingProvider;
  private ann: AnnIndex | null = null;
  private readonly keyToRowId = new Map<number, string>();
  private readonly rowIdToKey = new Map<string, number>();
  private nextKey = 1;

  constructor(options: L3LocalCacheOptions) {
    this.adapter = options.adapter;
    this.maxEntries = options.maxEntries ?? 50_000;
    this.embedder = options.embeddingProvider ?? new HashEmbeddingService();
  }

  async init(): Promise<void> {
    this.ann = await createAnnIndex(this.embedder.dimensions);
    await this.rebuildIndex();
  }

  async getByHash(hash: string): Promise<ChatResponse | undefined> {
    const row = this.adapter
      .prepare(
        `SELECT id, response FROM cache_entries
         WHERE prompt_hash = ?
         ORDER BY last_accessed_at DESC
         LIMIT 1`,
      )
      .get(hash) as { id: string; response: string } | undefined;

    if (!row) return undefined;

    this.adapter
      .prepare(`UPDATE cache_entries SET hit_count = hit_count + 1, last_accessed_at = datetime('now') WHERE id = ?`)
      .run(row.id);

    const response = JSON.parse(row.response) as ChatResponse;
    return { ...response, cached: true, cacheLayer: "L3" };
  }

  async set(hash: string, request: ChatRequest, response: ChatResponse): Promise<void> {
    const promptNormalized = serializePrompt(request.messages);
    const embedding = await this.embedder.embed(
      promptTextFromMessages(request.messages, { userOnly: true }),
    );
    const embeddingBlob = embeddingToBlob(embedding);
    const serialized = JSON.stringify({ ...response, cached: true, cacheLayer: "L3" });

    const existing = this.adapter
      .prepare(`SELECT id FROM cache_entries WHERE prompt_hash = ? LIMIT 1`)
      .get(hash) as { id: string } | undefined;

    const id = existing?.id ?? randomUUID();

    if (existing) {
      this.adapter
        .prepare(
          `UPDATE cache_entries
           SET prompt_normalized = ?, response = ?, embedding = ?, provider = ?, model = ?,
               last_accessed_at = datetime('now')
           WHERE id = ?`,
        )
        .run(promptNormalized, serialized, embeddingBlob, request.provider, request.model, id);
      this.removeFromIndex(id);
    } else {
      this.adapter
        .prepare(
          `INSERT INTO cache_entries
           (id, prompt_hash, prompt_normalized, response, embedding, provider, model)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, hash, promptNormalized, serialized, embeddingBlob, request.provider, request.model);
    }

    this.addToIndex(id, embedding);
    await this.evictIfNeeded();
  }

  async delete(hash: string): Promise<boolean> {
    const rows = this.adapter
      .prepare(`SELECT id FROM cache_entries WHERE prompt_hash = ?`)
      .all(hash) as Array<{ id: string }>;

    if (rows.length === 0) return false;

    for (const row of rows) {
      this.removeFromIndex(row.id);
      this.adapter.prepare(`DELETE FROM cache_entries WHERE id = ?`).run(row.id);
    }
    return true;
  }

  async clear(): Promise<void> {
    this.adapter.exec(`DELETE FROM cache_entries`);
    this.keyToRowId.clear();
    this.rowIdToKey.clear();
    this.nextKey = 1;
    this.ann?.clear();
  }

  async searchSimilar(query: ChatRequest, k = 5): Promise<Array<{ hash: string; distance: number }>> {
    if (!this.ann) await this.init();
    const queryEmbedding = await this.embedder.embed(
      promptTextFromMessages(query.messages, { userOnly: true }),
    );
    const { keys, distances } = this.ann!.search(queryEmbedding, k);

    const results: Array<{ hash: string; distance: number }> = [];
    for (let i = 0; i < keys.length; i++) {
      const rowId = this.keyToRowId.get(Number(keys[i]));
      if (!rowId) continue;
      const row = this.adapter
        .prepare(`SELECT prompt_hash FROM cache_entries WHERE id = ?`)
        .get(rowId) as { prompt_hash: string } | undefined;
      if (row) {
        results.push({ hash: row.prompt_hash, distance: distances[i] ?? 1 });
      }
    }
    return results;
  }

  async size(): Promise<number> {
    const row = this.adapter.prepare(`SELECT COUNT(*) as count FROM cache_entries`).get() as {
      count: number;
    };
    return row.count;
  }

  private addToIndex(rowId: string, embedding: Float32Array): void {
    if (!this.ann) return;
    const existingKey = this.rowIdToKey.get(rowId);
    const key = existingKey ?? this.nextKey++;
    if (!existingKey) {
      this.nextKey = Math.max(this.nextKey, key + 1);
    }
    this.rowIdToKey.set(rowId, key);
    this.keyToRowId.set(key, rowId);
    this.ann.add(key, embedding);
  }

  private removeFromIndex(rowId: string): void {
    const key = this.rowIdToKey.get(rowId);
    if (key === undefined || !this.ann) return;
    this.ann.remove(key);
    this.rowIdToKey.delete(rowId);
    this.keyToRowId.delete(key);
  }

  private async rebuildIndex(): Promise<void> {
    const rows = this.adapter
      .prepare(`SELECT id, embedding FROM cache_entries WHERE embedding IS NOT NULL`)
      .all() as Array<{ id: string; embedding: Uint8Array }>;

    for (const row of rows) {
      const embedding = blobToEmbedding(row.embedding);
      this.addToIndex(row.id, embedding);
    }
  }

  private async evictIfNeeded(): Promise<void> {
    const count = await this.size();
    if (count <= this.maxEntries) return;

    const overflow = count - this.maxEntries;
    const victims = this.adapter
      .prepare(
        `SELECT id FROM cache_entries
         ORDER BY last_accessed_at ASC
         LIMIT ?`,
      )
      .all(overflow) as Array<{ id: string }>;

    for (const victim of victims) {
      this.removeFromIndex(victim.id);
      this.adapter.prepare(`DELETE FROM cache_entries WHERE id = ?`).run(victim.id);
    }
  }
}

export const L3_LOCAL_PHASE = 4 as const;
