export interface Candidate {
  chunk_id: string;
  score: number;          // semantic similarity [0,1]
  content: string;
  chunk_type: string;
  name: string | null;
  path: string;
  start_line: number;
  end_line: number;
  graph_distance?: number; // normalized [0,1], lower = closer
  recency?: number;        // normalized [0,1], lower = more recent
  coedit_score?: number;   // normalized [0,1], higher = more co-edited with active file
}

export interface RankedResult extends Candidate {
  final_score: number;
}

const WEIGHTS = {
  semantic: 0.55,
  graph:    0.20,
  recency:  0.10,
  coedit:   0.15,
} as const;

/**
 * Re-ranks candidates combining semantic similarity, graph proximity,
 * file recency, and historical co-edit patterns.
 * Returns sorted descending by final_score.
 */
export function rankCandidates(candidates: Candidate[]): RankedResult[] {
  return candidates
    .map((c) => {
      const graphScore   = 1 - (c.graph_distance ?? 0.5); // invert: closer = higher
      const recencyScore = 1 - (c.recency ?? 0.5);        // invert: recent = higher
      const coeditScore  = c.coedit_score ?? 0;            // higher = more co-edited

      const final_score =
        WEIGHTS.semantic * c.score +
        WEIGHTS.graph    * graphScore +
        WEIGHTS.recency  * recencyScore +
        WEIGHTS.coedit   * coeditScore;

      return { ...c, final_score: Math.round(final_score * 10000) / 10000 };
    })
    .sort((a, b) => b.final_score - a.final_score);
}

/**
 * Normalizes file modification timestamps to [0,1].
 * Most recent = 0, oldest = 1.
 */
export function normalizeRecency(
  candidates: Candidate[],
  modifiedAtMap: Map<string, number>  // path -> unix timestamp
): Candidate[] {
  const timestamps = candidates
    .map((c) => modifiedAtMap.get(c.path) ?? 0)
    .filter((t) => t > 0);

  if (timestamps.length === 0) return candidates;

  const min = Math.min(...timestamps);
  const max = Math.max(...timestamps);
  const range = max - min || 1;

  return candidates.map((c) => {
    const ts = modifiedAtMap.get(c.path) ?? min;
    return { ...c, recency: (max - ts) / range };
  });
}
