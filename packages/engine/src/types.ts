import type { CoChangeResult } from "./history/cochange.js";

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

export interface IContextEngine {
  init(): Promise<void>;
  index(params: { projectPath: string; force?: boolean; paths?: string[] }): Promise<IndexResult>;
  mineHistory(params: { projectPath: string; force?: boolean; maxCommits?: number }): Promise<HistoryResult>;
  coChanges(params: CoChangeQuery): CoChangeResponse;
  status(params: { projectPath: string }): Promise<StatusResult>;
  graph(params: {
    target: string;
    projectPath: string;
    depth?: number;
    direction?: string;
  }): Promise<SubgraphResult>;
  close(): void;
}
