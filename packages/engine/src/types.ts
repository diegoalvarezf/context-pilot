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

export interface EmbeddingCandidate {
  chunkId: string;
  vector: Float32Array;
  content: string;
  chunkType: string;
  name: string | null;
  path: string;
  startLine: number;
  endLine: number;
  lastModified?: number;
}

export interface SearchResult {
  chunk_id: string;
  score: number;
  content: string;
  chunk_type: string;
  name: string | null;
  path: string;
  start_line: number;
  end_line: number;
  last_modified?: number;
}

export interface MemorySearchResult {
  id: string;
  memory_type: string;
  content: string;
  score: number;
  created_at: number;
}

export interface MemoryRecord {
  id: string;
  memory_type: string;
  content: string;
  session_id: string | null;
  relevance_score: number;
  created_at: number;
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
  error?: string;
}

export interface StatusResult {
  indexed: boolean;
  projectId?: string;
  projectPath: string;
  files?: number;
  chunks?: number;
  indexedAt?: number;
}

export interface IContextEngine {
  init(): Promise<void>;
  index(params: { projectPath: string; force?: boolean; paths?: string[] }): Promise<IndexResult>;
  search(params: {
    query: string;
    projectPath: string;
    k?: number;
    filterType?: string;
  }): Promise<{ results: SearchResult[] }>;
  status(params: { projectPath: string }): Promise<StatusResult>;
  graph(params: {
    target: string;
    projectPath: string;
    depth?: number;
    direction?: string;
  }): Promise<SubgraphResult>;
  graphDistances(params: {
    projectPath: string;
    activeChunkId: string;
    candidateIds: string[];
  }): Promise<{ distances: Record<string, number> }>;
  remember(params: {
    projectPath: string;
    sessionId: string;
    memoryType: "decision" | "pattern" | "todo" | "context_note";
    content: string;
  }): Promise<{ id: string; success: boolean }>;
  searchMemories(params: {
    query: string;
    projectPath: string;
    k?: number;
  }): Promise<{ results: MemorySearchResult[] }>;
  getCoEditScores(params: {
    projectPath: string;
    activeFilePath: string;
    candidatePaths: string[];
  }): Record<string, number>;
  getFileGraph(params: { projectPath: string }): Promise<{
    nodes: Array<{ id: string; path: string; language: string; chunkCount: number }>;
    edges: Array<{ from: string; to: string }>;
  }>;
  listMemories(params: { projectPath: string }): Promise<{ memories: MemoryRecord[] }>;
  deleteMemory(params: { projectPath: string; memoryId: string }): Promise<{ success: boolean }>;
  close(): void;
}
