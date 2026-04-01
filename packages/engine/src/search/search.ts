import type { EmbeddingCandidate, SearchResult } from "../types.js";

/**
 * Cosine similarity between two Float32Arrays.
 * Using typed arrays is ~5x faster than generic number[] in V8.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Semantic search over a list of embedding candidates.
 * Returns top-k results sorted by cosine similarity descending.
 */
export function semanticSearch(
  queryVector: Float32Array,
  candidates: EmbeddingCandidate[],
  k: number,
  filterType?: string
): SearchResult[] {
  const filtered =
    filterType && filterType !== "any"
      ? candidates.filter((c) => c.chunkType === filterType)
      : candidates;

  const scored = filtered.map((c) => ({
    chunk_id: c.chunkId,
    score: cosineSimilarity(queryVector, c.vector),
    content: c.content,
    chunk_type: c.chunkType,
    name: c.name,
    path: c.path,
    start_line: c.startLine,
    end_line: c.endLine,
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
