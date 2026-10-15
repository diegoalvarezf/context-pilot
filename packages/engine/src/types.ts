import type { CoChangeResult } from "./history/cochange.js";
import type { ImpactResult } from "./impact/impact.js";
import type { WorkingChange } from "./history/diff.js";

export interface Chunk {
  id: string;
  fileId: string;
  chunkType: "function" | "class" | "module";
  name: string | null;
  content: string;
  startLine: number;
  endLine: number;
  tokenCount: number;
  metadata?: Record<string, unknown>;
}

export interface GraphNode {
  id: string;
  chunkType: string;
  name: string | null;
  path: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  edgeType: "calls" | "extends" | "imports";
  weight: number;
}

export interface SubgraphResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  error?: string;
}

export interface IndexResult {
  success: boolean;
  projectId: string;
  projectPath: string;
  filesIndexed: number;
  filesSkipped: number;
  totalFiles: number;
  history?: HistoryResult;
  error?: string;
}

export type HistoryStatus = "full" | "incremental" | "up-to-date" | "not-a-git-repo" | "no-commits" | "error";

export interface HistoryResult {
  status: HistoryStatus;
  headSha?: string;
  commitsProcessed: number;
  /** Commits ignored as bulk changes (too many files) or touching only ignored files */
  commitsSkipped: number;
  files: number;
  pairs: number;
  error?: string;
}

export interface StatusResult {
  indexed: boolean;
  projectId?: string;
  projectPath: string;
  files?: number;
  chunks?: number;
  indexedAt?: number;
  history?: {
    headSha: string;
    minedAt: number;
    commitsProcessed: number;
    commitsSkipped: number;
    files: number;
    pairs: number;
  };
}

export type { CoChangeResult, CoChangeSource } from "./history/cochange.js";
export type { ImpactResult, ImpactSignal, ImpactSignalKind } from "./impact/impact.js";

export interface CoChangeQuery {
  projectPath: string;
  /** Files being changed — absolute, or relative to the project root */
  files: string[];
  limit?: number;
  /** Minimum number of shared commits (default 1) */
  minSupport?: number;
  /** Minimum recency-weighted confidence (default 0.1) */
  minConfidence?: number;
}

export interface CoChangeResponse {
  results: CoChangeResult[];
  /** Input files with no recorded history (new, ignored, or outside the repo) */
  unknownFiles: string[];
  historyAvailable: boolean;
}

export interface ImpactQuery {
  projectPath: string;
  /** Files being changed — absolute, or relative to the project root */
  files: string[];
  limit?: number;
  /** How many import hops to follow for dependents (default 2) */
  depth?: number;
}

export interface ImpactResponse {
  results: ImpactResult[];
  /** Input files with no co-change history */
  unknownFiles: string[];
  historyAvailable: boolean;
  graphAvailable: boolean;
}

export type { WorkingChange } from "./history/diff.js";

export interface CheckQuery {
  projectPath: string;
  /** Only staged changes (pre-commit); default: staged + unstaged + untracked vs HEAD */
  staged?: boolean;
  /** Compare against the merge-base with this ref (branch / PR review) */
  base?: string;
  /** Only report files whose strongest single signal reaches this (default 0.3) */
  minScore?: number;
  limit?: number;
}

export interface CheckResponse {
  /** Files in the change, as git reports them */
  changed: WorkingChange[];
  /** Likely affected files that are not part of the change */
  missing: ImpactResult[];
  /** Changed files with no co-change history (new or ignored) */
  unknownFiles: string[];
  historyAvailable: boolean;
  graphAvailable: boolean;
  /** Set when the change is too big to say anything useful (bulk / refactor) */
  skipped?: string;
}

export interface IContextEngine {
  init(): Promise<void>;
  index(params: { projectPath: string; force?: boolean; paths?: string[] }): Promise<IndexResult>;
  mineHistory(params: { projectPath: string; force?: boolean; maxCommits?: number }): Promise<HistoryResult>;
  coChanges(params: CoChangeQuery): CoChangeResponse;
  impact(params: ImpactQuery): ImpactResponse;
  checkChange(params: CheckQuery): Promise<CheckResponse>;
  status(params: { projectPath: string }): Promise<StatusResult>;
  graph(params: {
    target: string;
    projectPath: string;
    depth?: number;
    direction?: string;
  }): Promise<SubgraphResult>;
  close(): void;
}
