import { join } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";
import type { DatabaseSync } from "node:sqlite";
import type { IContextEngine, IndexResult, SearchResult, StatusResult, SubgraphResult } from "./types.js";
import { openDatabase, getAllEmbeddings, getProjectStats, getProjectGraphEdges, getChunksByIds, upsertProject } from "./storage/sqlite.js";
import { initEmbedder, embedSingle, embedTexts } from "./embedder/embedder.js";
import { initTreeSitter } from "./indexer/languages.js";
import { indexProject, projectId } from "./indexer/indexer.js";
import { semanticSearch } from "./search/search.js";
import { DiGraph } from "./graph/graph.js";
import type { EmbeddingCandidate } from "./types.js";

const MODEL = "all-MiniLM-L6-v2";
const EMBED_BATCH = 64;

export class ContextEngine implements IContextEngine {
  private db: DatabaseSync;
  private _initialized = false;

  // Per-project caches
  private embeddingsCache = new Map<string, EmbeddingCandidate[]>();
  private graphCache = new Map<string, DiGraph>();

  constructor(dbPath?: string) {
    const path = dbPath ?? join(homedir(), ".context-pilot", "db.sqlite");
    this.db = openDatabase(path);
  }

  async init(): Promise<void> {
    if (this._initialized) return;
    process.stderr.write("[engine] initializing tree-sitter...\n");
    await initTreeSitter();
    process.stderr.write("[engine] loading embedding model (first run may download ~90MB)...\n");
    await initEmbedder();
    this._initialized = true;
    process.stderr.write("[engine] ready\n");
  }

  async index(params: { projectPath: string; force?: boolean }): Promise<IndexResult> {
    if (!this._initialized) await this.init();

    const pid = projectId(params.projectPath);
    // Invalidate caches for this project
    this.embeddingsCache.delete(pid);
    this.graphCache.delete(pid);

    try {
      const { filesIndexed, filesSkipped, totalFiles } = await indexProject(
        this.db,
        params.projectPath,
        params.force ?? false
      );

      // Embed any chunks that don't have embeddings yet
      await this._embedNewChunks(pid);

      return {
        success: true,
        projectId: pid,
        projectPath: params.projectPath,
        filesIndexed,
        filesSkipped,
        totalFiles,
      };
    } catch (err) {
      return {
        success: false,
        projectId: pid,
        projectPath: params.projectPath,
        filesIndexed: 0,
        filesSkipped: 0,
        totalFiles: 0,
        error: String(err),
      };
    }
  }

  async search(params: {
    query: string;
    projectPath: string;
    k?: number;
    filterType?: string;
  }): Promise<{ results: SearchResult[] }> {
    if (!this._initialized) await this.init();

    const pid = projectId(params.projectPath);
    const candidates = await this._getEmbeddings(pid);

    if (candidates.length === 0) {
      return { results: [] };
    }

    const queryVec = await embedSingle(params.query);
    const results = semanticSearch(queryVec, candidates, params.k ?? 10, params.filterType);
    return { results };
  }

  async status(params: { projectPath: string }): Promise<StatusResult> {
    const pid = projectId(params.projectPath);
    const project = this.db
      .prepare(`SELECT indexed_at FROM projects WHERE id = ?`)
      .get(pid) as { indexed_at: number | null } | undefined;

    if (!project) {
      return { indexed: false, projectPath: params.projectPath };
    }

    const stats = getProjectStats(this.db, pid);
    return {
      indexed: project.indexed_at !== null,
      projectId: pid,
      projectPath: params.projectPath,
      files: stats.files,
      chunks: stats.chunks,
      indexedAt: project.indexed_at ?? undefined,
    };
  }

  async graph(params: {
    target: string;
    projectPath: string;
    depth?: number;
    direction?: string;
  }): Promise<SubgraphResult> {
    const pid = projectId(params.projectPath);
    const g = await this._getGraph(pid);

    // Find root node — match by name or path
    let rootId: string | undefined;
    for (const [id, attrs] of g.allNodes()) {
      if (attrs.name === params.target || attrs.path.endsWith(params.target)) {
        rootId = id;
        break;
      }
    }

    if (!rootId) {
      return { nodes: [], edges: [], error: `Target not found: ${params.target}` };
    }

    const direction = (params.direction ?? "both") as "outgoing" | "incoming" | "both";
    const { nodeIds, edges } = g.subgraph(rootId, params.depth ?? 2, direction);

    const nodes = [...nodeIds].map((id) => {
      const attrs = g.getNode(id)!;
      return { id, chunkType: attrs.chunkType, name: attrs.name, path: attrs.path };
    });

    return {
      nodes,
      edges: edges.map((e) => ({
        from: e.from,
        to: e.to,
        edgeType: e.attrs.edgeType as "calls" | "extends" | "imports",
        weight: e.attrs.weight,
      })),
    };
  }

  async graphDistances(params: {
    projectPath: string;
    activeChunkId: string;
    candidateIds: string[];
  }): Promise<{ distances: Record<string, number> }> {
    const pid = projectId(params.projectPath);
    const g = await this._getGraph(pid);
    const distances = g.shortestPathDistances(params.activeChunkId, params.candidateIds);
    return { distances };
  }

  async remember(params: {
    projectPath: string;
    sessionId: string;
    memoryType: "decision" | "pattern" | "todo" | "context_note";
    content: string;
  }): Promise<{ id: string; success: boolean }> {
    const pid = projectId(params.projectPath);
    upsertProject(this.db, pid, params.projectPath);
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO memories (id, project_id, session_id, memory_type, content, relevance_score, created_at)
      VALUES (?, ?, ?, ?, ?, 1.0, ?)
    `).run(id, pid, params.sessionId, params.memoryType, params.content, Date.now());
    return { id, success: true };
  }

  close(): void {
    this.db.close();
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private async _getEmbeddings(projectId: string): Promise<EmbeddingCandidate[]> {
    if (this.embeddingsCache.has(projectId)) return this.embeddingsCache.get(projectId)!;
    const candidates = getAllEmbeddings(this.db, projectId);
    this.embeddingsCache.set(projectId, candidates);
    return candidates;
  }

  private async _getGraph(projectId: string): Promise<DiGraph> {
    if (this.graphCache.has(projectId)) return this.graphCache.get(projectId)!;

    const g = new DiGraph();

    // Add all chunks as nodes
    const chunks = this.db.prepare(`
      SELECT c.id, c.chunk_type, c.name, f.path
      FROM chunks c JOIN files f ON f.id = c.file_id
      WHERE f.project_id = ?
    `).all(projectId) as Array<{ id: string; chunk_type: string; name: string | null; path: string }>;

    for (const c of chunks) {
      g.addNode(c.id, { chunkType: c.chunk_type, name: c.name, path: c.path });
    }

    // Add edges
    const edges = getProjectGraphEdges(this.db, projectId);
    for (const e of edges) {
      g.addEdge(e.from_chunk, e.to_chunk, { edgeType: e.edge_type, weight: e.weight });
    }

    this.graphCache.set(projectId, g);
    return g;
  }

  private async _embedNewChunks(pid: string): Promise<void> {
    // Find chunks without embeddings
    const unembedded = this.db.prepare(`
      SELECT c.id, c.content
      FROM chunks c
      JOIN files f ON f.id = c.file_id
      WHERE f.project_id = ?
        AND c.id NOT IN (SELECT chunk_id FROM embeddings)
    `).all(pid) as Array<{ id: string; content: string }>;

    if (unembedded.length === 0) return;

    process.stderr.write(`[engine] embedding ${unembedded.length} new chunks...\n`);

    const texts = unembedded.map((c) => c.content);
    const vectors = await embedTexts(texts);

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO embeddings (chunk_id, model, vector, dims, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    const { vectorToBlob } = await import("./storage/sqlite.js");
    this.db.exec("BEGIN");
    try {
      for (let i = 0; i < unembedded.length; i++) {
        stmt.run(
          unembedded[i].id,
          MODEL,
          vectorToBlob(vectors[i]),
          vectors[i].length,
          Date.now()
        );
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }

    // Invalidate embeddings cache
    this.embeddingsCache.delete(pid);
  }
}
