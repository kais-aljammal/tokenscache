declare module "usearch" {
  export interface IndexOptions {
    metric?: string;
    connectivity?: number;
    dimensions: number;
  }

  export interface SearchResult {
    keys: bigint[];
    distances: number[];
  }

  export class Index {
    constructor(options: IndexOptions);
    add(key: bigint, vector: Float32Array): void;
    search(vector: Float32Array, count: number): SearchResult;
    size(): number;
    remove(key: bigint): void;
    reset?(): void;
  }
}
