import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { applySchema } from "./schema.js";
import type { Chunk, GraphEdge } from "../types.js";
import type { FileStats, PairStats } from "../history/cochange.js";
import type { ImportEdge } from "../indexer/imports.js";

export function openDatabase(dbPath: string): DatabaseSync {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  applySchema(db);
  return db;
}

export function tx(db: DatabaseSync, fn: () => void): void {
  db.exec("BEGIN");
  try {
    fn();
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// ── Project ───────────────────────────────────────────────────────────────────

export function upsertProject(db: DatabaseSync, projectId: string, rootPath: string): void {
  // A row with this path under another id predates path normalization in projectId();
  // its data is a re-derivable cache, so drop it (cascades) instead of failing on UNIQUE.
  db.prepare(`DELETE FROM projects WHERE root_path = ? AND id != ?`).run(rootPath, projectId);
  db.prepare(`
    INSERT INTO projects (id, name, root_path, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET root_path = excluded.root_path
  `).run(projectId, rootPath, rootPath, Date.now());
}

export function markProjectIndexed(db: DatabaseSync, projectId: string): void {
  db.prepare(`UPDATE projects SET indexed_at = ? WHERE id = ?`).run(Date.now(), projectId);
}

export function getProject(
  db: DatabaseSync,
  projectId: string
): { indexed_at: number | null; root_path: string } | undefined {
  return db
    .prepare(`SELECT root_path, indexed_at FROM projects WHERE id = ?`)
    .get(projectId) as { root_path: string; indexed_at: number | null } | undefined;
}

// ── Files ─────────────────────────────────────────────────────────────────────

export function upsertFile(
  db: DatabaseSync,
  fileId: string,
  projectId: string,
  relPath: string,
  language: string,
  hash: string,
  lastModified: number
): void {
  db.prepare(`
    INSERT INTO files (id, project_id, path, language, hash, last_modified)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, path) DO UPDATE SET
      id = excluded.id,
      language = excluded.language,
      hash = excluded.hash,
      last_modified = excluded.last_modified
  `).run(fileId, projectId, relPath, language, hash, lastModified);
}

export function getFileHash(
  db: DatabaseSync,
  projectId: string,
  relPath: string
): string | undefined {
  const row = db
    .prepare(`SELECT hash FROM files WHERE project_id = ? AND path = ?`)
    .get(projectId, relPath) as { hash: string } | undefined;
  return row?.hash;
}

export function deleteFileChunks(db: DatabaseSync, fileId: string): void {
  db.prepare(`DELETE FROM chunks WHERE file_id = ?`).run(fileId);
}

export function getProjectFiles(
  db: DatabaseSync,
  projectId: string
): Array<{ id: string; path: string }> {
  return db
    .prepare(`SELECT id, path FROM files WHERE project_id = ?`)
    .all(projectId) as Array<{ id: string; path: string }>;
}

// ── Chunks ────────────────────────────────────────────────────────────────────

export function insertChunks(db: DatabaseSync, chunks: Chunk[]): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO chunks
      (id, file_id, chunk_type, name, content, start_line, end_line, token_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  tx(db, () => {
    for (const c of chunks) {
      stmt.run(c.id, c.fileId, c.chunkType, c.name ?? null, c.content, c.startLine, c.endLine, c.tokenCount);
    }
  });
}

export function getProjectStats(db: DatabaseSync, projectId: string): { files: number; chunks: number } {
  const files = (db
    .prepare(`SELECT COUNT(*) as n FROM files WHERE project_id = ?`)
    .get(projectId) as { n: number }).n;
  const chunks = (db
    .prepare(`
      SELECT COUNT(*) as n FROM chunks c
      JOIN files f ON f.id = c.file_id
      WHERE f.project_id = ?
    `)
    .get(projectId) as { n: number }).n;
  return { files, chunks };
}

// ── Graph edges ───────────────────────────────────────────────────────────────

export function insertGraphEdges(db: DatabaseSync, projectId: string, edges: GraphEdge[]): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO graph_edges (id, project_id, from_chunk, to_chunk, edge_type, weight)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  tx(db, () => {
    for (const e of edges) {
      stmt.run(`${e.from}:${e.to}:${e.edgeType}`, projectId, e.from, e.to, e.edgeType, e.weight);
    }
  });
}

export function getProjectGraphEdges(
  db: DatabaseSync,
  projectId: string
): Array<{ from_chunk: string; to_chunk: string; edge_type: string; weight: number }> {
  return db
    .prepare(`SELECT from_chunk, to_chunk, edge_type, weight FROM graph_edges WHERE project_id = ?`)
    .all(projectId) as Array<{
      from_chunk: string;
      to_chunk: string;
      edge_type: string;
      weight: number;
    }>;
}

export function getFileRepresentativeChunk(db: DatabaseSync, fileId: string): string | undefined {
  const row = db
    .prepare(`SELECT id FROM chunks WHERE file_id = ? ORDER BY start_line LIMIT 1`)
    .get(fileId) as { id: string } | undefined;
  return row?.id;
}

export function deleteProjectGraphEdges(db: DatabaseSync, projectId: string): void {
  db.prepare(`DELETE FROM graph_edges WHERE project_id = ?`).run(projectId);
}

export function getChunksByIds(
  db: DatabaseSync,
  ids: string[]
): Array<{ id: string; chunk_type: string; name: string | null; path: string }> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  return db
    .prepare(`
      SELECT c.id, c.chunk_type, c.name, f.path
      FROM chunks c
      JOIN files f ON f.id = c.file_id
      WHERE c.id IN (${placeholders})
    `)
    .all(...ids) as Array<{ id: string; chunk_type: string; name: string | null; path: string }>;
}

// ── File imports ──────────────────────────────────────────────────────────────

export function replaceFileImports(db: DatabaseSync, projectId: string, edges: ImportEdge[]): void {
  const stmt = db.prepare(`INSERT OR IGNORE INTO file_imports (project_id, from_path, to_path) VALUES (?, ?, ?)`);
  tx(db, () => {
    db.prepare(`DELETE FROM file_imports WHERE project_id = ?`).run(projectId);
    for (const e of edges) stmt.run(projectId, e.from, e.to);
  });
}

export function getFileImports(db: DatabaseSync, projectId: string): ImportEdge[] {
  return db
    .prepare(`SELECT from_path AS "from", to_path AS "to" FROM file_imports WHERE project_id = ?`)
    .all(projectId) as unknown as ImportEdge[];
}

export function getIndexedPaths(db: DatabaseSync, projectId: string): string[] {
  return (db.prepare(`SELECT path FROM files WHERE project_id = ?`).all(projectId) as Array<{ path: string }>).map(
    (r) => r.path
  );
}

// ── Co-change history ─────────────────────────────────────────────────────────

export function clearCoChanges(db: DatabaseSync, projectId: string): void {
  db.prepare(`DELETE FROM cochange_pairs WHERE project_id = ?`).run(projectId);
  db.prepare(`DELETE FROM cochange_files WHERE project_id = ?`).run(projectId);
  db.prepare(`DELETE FROM cochange_state WHERE project_id = ?`).run(projectId);
}

/** Adds mined statistics on top of whatever is stored (incremental-safe). */
export function addCoChanges(
  db: DatabaseSync,
  projectId: string,
  files: Iterable<FileStats>,
  pairs: Iterable<PairStats>
): void {
  const fileStmt = db.prepare(`
    INSERT INTO cochange_files (project_id, path, commits, wcommits, last_ts)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(project_id, path) DO UPDATE SET
      commits  = commits + excluded.commits,
      wcommits = wcommits + excluded.wcommits,
      last_ts  = MAX(last_ts, excluded.last_ts)
  `);
  const pairStmt = db.prepare(`
    INSERT INTO cochange_pairs (project_id, file_a, file_b, support, wsupport, last_ts)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, file_a, file_b) DO UPDATE SET
      support  = support + excluded.support,
      wsupport = wsupport + excluded.wsupport,
      last_ts  = MAX(last_ts, excluded.last_ts)
  `);
  for (const f of files) fileStmt.run(projectId, f.path, f.commits, f.wcommits, f.lastTs);
  for (const p of pairs) pairStmt.run(projectId, p.fileA, p.fileB, p.support, p.wsupport, p.lastTs);
}

export interface CoChangeState {
  head_sha: string;
  commits_processed: number;
  commits_skipped: number;
  mined_at: number;
}

export function getCoChangeState(db: DatabaseSync, projectId: string): CoChangeState | undefined {
  return db
    .prepare(`SELECT head_sha, commits_processed, commits_skipped, mined_at FROM cochange_state WHERE project_id = ?`)
    .get(projectId) as CoChangeState | undefined;
}

export function setCoChangeState(db: DatabaseSync, projectId: string, state: CoChangeState): void {
  db.prepare(`
    INSERT INTO cochange_state (project_id, head_sha, commits_processed, commits_skipped, mined_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET
      head_sha          = excluded.head_sha,
      commits_processed = excluded.commits_processed,
      commits_skipped   = excluded.commits_skipped,
      mined_at          = excluded.mined_at
  `).run(projectId, state.head_sha, state.commits_processed, state.commits_skipped, state.mined_at);
}

export function getCoChangeFileStats(
  db: DatabaseSync,
  projectId: string,
  paths: string[]
): Map<string, { commits: number; wcommits: number }> {
  const result = new Map<string, { commits: number; wcommits: number }>();
  const stmt = db.prepare(`SELECT commits, wcommits FROM cochange_files WHERE project_id = ? AND path = ?`);
  for (const path of paths) {
    const row = stmt.get(projectId, path) as { commits: number; wcommits: number } | undefined;
    if (row) result.set(path, row);
  }
  return result;
}

/** All pairs involving `path`, oriented as (source = path, candidate = other file). */
export function getCoChangePartners(
  db: DatabaseSync,
  projectId: string,
  path: string
): Array<{ source: string; candidate: string; support: number; wsupport: number; lastTs: number }> {
  const rows = db.prepare(`
    SELECT file_b AS candidate, support, wsupport, last_ts FROM cochange_pairs
    WHERE project_id = ? AND file_a = ?
    UNION ALL
    SELECT file_a AS candidate, support, wsupport, last_ts FROM cochange_pairs
    WHERE project_id = ? AND file_b = ?
  `).all(projectId, path, projectId, path) as Array<{
    candidate: string;
    support: number;
    wsupport: number;
    last_ts: number;
  }>;
  return rows.map((r) => ({
    source: path,
    candidate: r.candidate,
    support: r.support,
    wsupport: r.wsupport,
    lastTs: r.last_ts,
  }));
}

export function getCoChangeStats(db: DatabaseSync, projectId: string): { files: number; pairs: number } {
  const files = (db.prepare(`SELECT COUNT(*) AS n FROM cochange_files WHERE project_id = ?`).get(projectId) as { n: number }).n;
  const pairs = (db.prepare(`SELECT COUNT(*) AS n FROM cochange_pairs WHERE project_id = ?`).get(projectId) as { n: number }).n;
  return { files, pairs };
}
