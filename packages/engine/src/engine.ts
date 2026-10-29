import { existsSync, readFileSync, statSync } from "fs";
import { homedir } from "os";
import { isAbsolute, join, relative } from "path";
import type { DatabaseSync } from "node:sqlite";
import type {
  CheckQuery,
  CheckResponse,
  FindSymbolResponse,
  OutlineResponse,
  PilotQuery,
  PilotResult,
  CoChangeQuery,
  CoChangeResponse,
  ImpactQuery,
  ImpactResponse,
  HistoryResult,
  IContextEngine,
  IndexResult,
  StatusResult,
  SubgraphResult,
} from "./types.js";
import {
  openDatabase,
  getProjectStats,
  getProjectGraphEdges,
  getCoChangeState,
  getCoChangeStats,
  getCoChangeFileStats,
  getCoChangePartners,
  getFileImports,
  getIndexedPaths,
  getProject,
  getFileSymbols,
  getProjectSymbols,
  findSymbolDefs,
  findSymbolRefs,
  type SymbolRow,
} from "./storage/sqlite.js";
import { searchFiles } from "./pilot/search.js";
import { DEFAULT_PILOT_BUDGET, pilot, type OutlineSymbol } from "./pilot/pilot.js";
import { computeImpact, DEFAULT_IMPACT_DEPTH } from "./impact/impact.js";
import { initTreeSitter } from "./indexer/languages.js";
import { indexProject, indexSpecificFiles, projectId } from "./indexer/indexer.js";
import { DiGraph } from "./graph/graph.js";
import { mineHistory } from "./history/miner.js";
import {
  combineCoChanges,
  defaultIgnore,
  DEFAULT_MAX_FILES_PER_COMMIT,
  DEFAULT_MIN_CONFIDENCE,
  DEFAULT_MIN_SUPPORT,
} from "./history/cochange.js";
import { isGitRepo } from "./history/git.js";
import { readWorkingChanges } from "./history/diff.js";

const DEFAULT_COCHANGE_LIMIT = 10;
const DEFAULT_FRESH_MS = 5 * 60_000;
const DEFAULT_FIND_LIMIT = 30;
// Seed files from the text search that get expanded with impact()
const PILOT_SEEDS = 5;

const toOutline = (r: SymbolRow): OutlineSymbol => ({
  name: r.name,
  kind: r.kind,
  parent: r.parent,
  startLine: r.start_line,
  endLine: r.end_line,
  signature: r.signature,
});
// Co-change candidates fed into impact scoring, before the final limit
const IMPACT_COCHANGE_POOL = 50;
// Calibrated with `backtest --with-graph --calibrate` (see CLAUDE.md): ~50-65% of alerts are real
export const DEFAULT_CHECK_MIN_SCORE = 0.6;

/** Normalizes a user-supplied path to the project-relative, forward-slash form used in storage. */
export function toProjectPath(projectPath: string, file: string): string {
  const rel = isAbsolute(file) ? relative(projectPath, file) : file;
  return rel.replace(/\\/g, "/").replace(/^\.\//, "");
}

export class ContextEngine implements IContextEngine {
  private db: DatabaseSync;
  private _initialized = false;

  // Per-project cache, invalidated on re-index
  private graphCache = new Map<string, DiGraph>();

  constructor(dbPath?: string) {
    const path = dbPath ?? join(homedir(), ".context-pilot", "db.sqlite");
    this.db = openDatabase(path);
  }

  async init(): Promise<void> {
    if (this._initialized) return;
    await initTreeSitter();
    this._initialized = true;
  }

  async index(params: { projectPath: string; force?: boolean; paths?: string[] }): Promise<IndexResult> {
    if (!this._initialized) await this.init();

    const pid = projectId(params.projectPath);
    this.graphCache.delete(pid);

    try {
      if (params.paths && params.paths.length > 0) {
        // Targeted re-index of specific files (used by watcher); history only changes on commit
        const counts = await indexSpecificFiles(this.db, params.projectPath, params.paths, params.force ?? false);
        return { success: true, projectId: pid, projectPath: params.projectPath, ...counts };
      }

      const counts = await indexProject(this.db, params.projectPath, params.force ?? false);
      const history = await this.mineHistory({ projectPath: params.projectPath, force: params.force });
      return { success: true, projectId: pid, projectPath: params.projectPath, ...counts, history };
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

  async mineHistory(params: { projectPath: string; force?: boolean; maxCommits?: number }): Promise<HistoryResult> {
    try {
      return await mineHistory(this.db, projectId(params.projectPath), params.projectPath, params);
    } catch (err) {
      return { status: "error", commitsProcessed: 0, commitsSkipped: 0, files: 0, pairs: 0, error: String(err) };
    }
  }

  coChanges(params: CoChangeQuery): CoChangeResponse {
    const pid = projectId(params.projectPath);
    const historyAvailable = getCoChangeState(this.db, pid) !== undefined;
    const sources = [...new Set(params.files.map((f) => toProjectPath(params.projectPath, f)))];

    const stats = getCoChangeFileStats(this.db, pid, sources);
    const unknownFiles = sources.filter((s) => !stats.has(s));
    const sourceSet = new Set(sources);

    const rows = sources
      .flatMap((s) => getCoChangePartners(this.db, pid, s))
      .filter((r) => !sourceSet.has(r.candidate));

    const results = combineCoChanges(rows, stats, {
      minSupport: params.minSupport ?? DEFAULT_MIN_SUPPORT,
      minConfidence: params.minConfidence ?? DEFAULT_MIN_CONFIDENCE,
    })
      // History remembers deleted files; only suggest what still exists
      .filter((r) => existsSync(join(params.projectPath, r.path)))
      .slice(0, params.limit ?? DEFAULT_COCHANGE_LIMIT);

    return { results, unknownFiles, historyAvailable };
  }

  impact(params: ImpactQuery): ImpactResponse {
    const pid = projectId(params.projectPath);
    const co = this.coChanges({ projectPath: params.projectPath, files: params.files, limit: IMPACT_COCHANGE_POOL });
    const imports = getFileImports(this.db, pid);
    const files = getIndexedPaths(this.db, pid);
    const changed = [...new Set(params.files.map((f) => toProjectPath(params.projectPath, f)))];

    const results = computeImpact({
      changed,
      coChanges: co.results,
      imports,
      files,
      maxDepth: params.depth ?? DEFAULT_IMPACT_DEPTH,
    })
      .filter((r) => existsSync(join(params.projectPath, r.path)))
      .slice(0, params.limit ?? DEFAULT_COCHANGE_LIMIT);

    return {
      results,
      unknownFiles: co.unknownFiles,
      historyAvailable: co.historyAvailable,
      graphAvailable: files.length > 0,
    };
  }

  async checkChange(params: CheckQuery): Promise<CheckResponse> {
    const empty = { changed: [], missing: [], unknownFiles: [], historyAvailable: false, graphAvailable: false };
    if (!(await isGitRepo(params.projectPath))) return { ...empty, skipped: "not a git repository" };

    const changed = await readWorkingChanges(params.projectPath, { staged: params.staged, base: params.base });
    // Deleted and renamed-away paths still matter: history knows their partners
    const queried = [...new Set(changed.flatMap((c) => (c.oldPath ? [c.path, c.oldPath] : [c.path])))].filter(
      (p) => !defaultIgnore(p)
    );
    if (queried.length === 0) return { ...empty, changed };
    // Same cut-off as mining: a change this large is a bulk edit, its co-changes are noise
    if (queried.length > DEFAULT_MAX_FILES_PER_COMMIT) {
      return { ...empty, changed, skipped: `${queried.length} files changed (bulk change)` };
    }

    const minScore = params.minScore ?? DEFAULT_CHECK_MIN_SCORE;
    const impact = this.impact({ projectPath: params.projectPath, files: queried, limit: IMPACT_COCHANGE_POOL });
    const inChange = new Set(queried);
    // Threshold on the strongest single signal: the noisy-OR score saturates when many files change
    const missing = impact.results
      .filter((r) => (r.signals[0]?.weight ?? 0) >= minScore && !inChange.has(r.path))
      .slice(0, params.limit ?? DEFAULT_COCHANGE_LIMIT);

    return {
      changed,
      missing,
      unknownFiles: impact.unknownFiles,
      historyAvailable: impact.historyAvailable,
      graphAvailable: impact.graphAvailable,
    };
  }

  async ensureFresh(params: { projectPath: string; maxAgeMs?: number }): Promise<void> {
    const project = getProject(this.db, projectId(params.projectPath));
    const age = project?.indexed_at ? Date.now() - project.indexed_at : Infinity;
    if (age > (params.maxAgeMs ?? DEFAULT_FRESH_MS)) await this.index({ projectPath: params.projectPath });
    else await this.mineHistory({ projectPath: params.projectPath });
  }

  pilot(params: PilotQuery): PilotResult {
    const pid = projectId(params.projectPath);
    const files = (params.files ?? []).map((f) => toProjectPath(params.projectPath, f));
    const symbols = getProjectSymbols(this.db, pid).map((s) => ({
      path: s.path,
      name: s.name,
      kind: s.kind,
      startLine: s.start_line,
    }));
    const hits = searchFiles(params.task, symbols, getIndexedPaths(this.db, pid)).filter((h) =>
      existsSync(join(params.projectPath, h.path))
    );
    const seeds = [...new Set([...files, ...hits.slice(0, PILOT_SEEDS).filter((h) => h.score >= 0.3).map((h) => h.path)])];
    const impact =
      seeds.length && params.expand !== false
        ? this.impact({ projectPath: params.projectPath, files: seeds, limit: 15 }).results
        : [];

    const sourceLines = new Map<string, string[] | null>();
    const read = (path: string) => {
      if (!sourceLines.has(path)) {
        try {
          sourceLines.set(path, readFileSync(join(params.projectPath, path), "utf8").split(/\r?\n/));
        } catch {
          sourceLines.set(path, null);
        }
      }
      return sourceLines.get(path)!;
    };

    return pilot({
      task: params.task,
      files,
      hits,
      impact,
      budget: params.budget ?? DEFAULT_PILOT_BUDGET,
      outline: (path) => getFileSymbols(this.db, pid, path).map(toOutline),
      fileTokens: (path) => this.fileTokens(params.projectPath, path),
      lines: (path, start, end) => read(path)?.slice(start - 1, end).join("\n") ?? null,
    });
  }

  outline(params: { projectPath: string; file: string }): OutlineResponse {
    const path = toProjectPath(params.projectPath, params.file);
    const pid = projectId(params.projectPath);
    return {
      path,
      symbols: getFileSymbols(this.db, pid, path).map(toOutline),
      fileTokens: this.fileTokens(params.projectPath, path),
      indexed: getIndexedPaths(this.db, pid).includes(path),
    };
  }

  findSymbol(params: { projectPath: string; name: string; limit?: number }): FindSymbolResponse {
    const pid = projectId(params.projectPath);
    // "Class.method" or "module.fn": look up the last part
    const name = params.name.trim().split(/[.:#]/).pop() ?? params.name;
    const definitions = findSymbolDefs(this.db, pid, name).map((r) => ({
      ...toOutline(r),
      path: r.path,
      exported: r.exported === 1,
    }));
    const byFile = new Map<string, number[]>();
    for (const r of findSymbolRefs(this.db, pid, name)) {
      const lines = byFile.get(r.path) ?? [];
      lines.push(r.line);
      byFile.set(r.path, lines);
    }
    const uses = [...byFile.entries()]
      .map(([path, lines]) => ({ path, lines }))
      .sort((a, b) => b.lines.length - a.lines.length);
    return {
      name,
      definitions,
      uses: uses.slice(0, params.limit ?? DEFAULT_FIND_LIMIT),
      totalUses: uses.reduce((a, u) => a + u.lines.length, 0),
    };
  }

  indexedFiles(params: { projectPath: string }): string[] {
    return getIndexedPaths(this.db, projectId(params.projectPath));
  }

  private fileTokens(projectPath: string, path: string): number {
    try {
      return Math.ceil(statSync(join(projectPath, path)).size / 4);
    } catch {
      return 0;
    }
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
    const state = getCoChangeState(this.db, pid);
    return {
      indexed: project.indexed_at !== null,
      projectId: pid,
      projectPath: params.projectPath,
      files: stats.files,
      chunks: stats.chunks,
      indexedAt: project.indexed_at ?? undefined,
      history: state && {
        headSha: state.head_sha,
        minedAt: state.mined_at,
        commitsProcessed: state.commits_processed,
        commitsSkipped: state.commits_skipped,
        ...getCoChangeStats(this.db, pid),
      },
    };
  }

  async graph(params: {
    target: string;
    projectPath: string;
    depth?: number;
    direction?: string;
  }): Promise<SubgraphResult> {
    const pid = projectId(params.projectPath);
    const g = this._getGraph(pid);

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

  close(): void {
    this.db.close();
  }

  private _getGraph(projectId: string): DiGraph {
    if (this.graphCache.has(projectId)) return this.graphCache.get(projectId)!;

    const g = new DiGraph();

    const chunks = this.db.prepare(`
      SELECT c.id, c.chunk_type, c.name, f.path
      FROM chunks c JOIN files f ON f.id = c.file_id
      WHERE f.project_id = ?
    `).all(projectId) as Array<{ id: string; chunk_type: string; name: string | null; path: string }>;

    for (const c of chunks) {
      g.addNode(c.id, { chunkType: c.chunk_type, name: c.name, path: c.path });
    }

    for (const e of getProjectGraphEdges(this.db, projectId)) {
      g.addEdge(e.from_chunk, e.to_chunk, { edgeType: e.edge_type, weight: e.weight });
    }

    this.graphCache.set(projectId, g);
    return g;
  }
}
