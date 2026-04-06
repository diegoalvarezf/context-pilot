import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { applySchema } from "./schema.js";
import type { Chunk, EmbeddingCandidate, GraphEdge } from "../types.js";

export function openDatabase(dbPath: string): DatabaseSync {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  applySchema(db);
  return db;
}

// ── Vector serialization ──────────────────────────────────────────────────────
// Bit-compatible with Python's struct.pack(f"{n}f", *vector) — little-endian f32

export function vectorToBlob(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

export function blobToVector(blob: Buffer | Uint8Array): Float32Array {
  const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  const copy = Buffer.allocUnsafe(buf.length);
  buf.copy(copy);
  return new Float32Array(copy.buffer);
}

function tx(db: DatabaseSync, fn: () => void): void {
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

// ── Embeddings ────────────────────────────────────────────────────────────────

export function upsertEmbeddings(
  db: DatabaseSync,
  entries: Array<{ chunkId: string; vector: Float32Array; model: string }>
): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO embeddings (chunk_id, model, vector, dims, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  tx(db, () => {
    for (const item of entries) {
      stmt.run(item.chunkId, item.model, vectorToBlob(item.vector), item.vector.length, Date.now());
    }
  });
}

export function getAllEmbeddings(db: DatabaseSync, projectId: string): EmbeddingCandidate[] {
  const rows = db.prepare(`
    SELECT
      e.chunk_id,
      e.vector,
      c.content,
      c.chunk_type,
      c.name,
      c.start_line,
      c.end_line,
      f.path,
      f.last_modified
    FROM embeddings e
    JOIN chunks c ON c.id = e.chunk_id
    JOIN files  f ON f.id = c.file_id
    WHERE f.project_id = ?
  `).all(projectId) as Array<{
    chunk_id: string;
    vector: Buffer;
    content: string;
    chunk_type: string;
    name: string | null;
    start_line: number;
    end_line: number;
    path: string;
    last_modified: number | null;
  }>;

  return rows.map((r) => ({
    chunkId: r.chunk_id,
    vector: blobToVector(r.vector),
    content: r.content,
    chunkType: r.chunk_type,
    name: r.name,
    startLine: r.start_line,
    endLine: r.end_line,
    path: r.path,
    lastModified: r.last_modified ?? undefined,
  }));
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

export function upsertMemoryEmbedding(
  db: DatabaseSync,
  memoryId: string,
  vector: Float32Array,
  model: string
): void {
  db.prepare(`
    INSERT OR REPLACE INTO memory_embeddings (memory_id, model, vector, dims, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(memoryId, model, vectorToBlob(vector), vector.length, Date.now());
}

export function getMemoryEmbeddings(
  db: DatabaseSync,
  projectId: string
): Array<{ memoryId: string; vector: Float32Array; memoryType: string; content: string; createdAt: number }> {
  const rows = db.prepare(`
    SELECT me.memory_id, me.vector, m.memory_type, m.content, m.created_at
    FROM memory_embeddings me
    JOIN memories m ON m.id = me.memory_id
    WHERE m.project_id = ?
    ORDER BY m.created_at DESC
  `).all(projectId) as Array<{
    memory_id: string;
    vector: Buffer;
    memory_type: string;
    content: string;
    created_at: number;
  }>;

  return rows.map((r) => ({
    memoryId: r.memory_id,
    vector: blobToVector(r.vector),
    memoryType: r.memory_type,
    content: r.content,
    createdAt: r.created_at,
  }));
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
