import type { DatabaseSync } from "node:sqlite";

export function applySchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      root_path   TEXT NOT NULL UNIQUE,
      config      TEXT,
      indexed_at  INTEGER,
      created_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS files (
      id            TEXT PRIMARY KEY,
      project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      path          TEXT NOT NULL,
      language      TEXT,
      hash          TEXT NOT NULL,
      last_modified INTEGER,
      UNIQUE(project_id, path)
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id          TEXT PRIMARY KEY,
      file_id     TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      chunk_type  TEXT NOT NULL,
      name        TEXT,
      content     TEXT NOT NULL,
      start_line  INTEGER NOT NULL,
      end_line    INTEGER NOT NULL,
      token_count INTEGER NOT NULL,
      metadata    TEXT
    );

    CREATE TABLE IF NOT EXISTS embeddings (
      chunk_id   TEXT PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE,
      model      TEXT NOT NULL,
      vector     BLOB NOT NULL,
      dims       INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS graph_edges (
      id         TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      from_chunk TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
      to_chunk   TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
      edge_type  TEXT NOT NULL,
      weight     REAL DEFAULT 1.0
    );

    CREATE TABLE IF NOT EXISTS memories (
      id              TEXT PRIMARY KEY,
      project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      session_id      TEXT,
      memory_type     TEXT NOT NULL,
      content         TEXT NOT NULL,
      relevance_score REAL DEFAULT 1.0,
      created_at      INTEGER NOT NULL,
      expires_at      INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_chunks_file       ON chunks(file_id);
    CREATE INDEX IF NOT EXISTS idx_files_project     ON files(project_id);
    CREATE INDEX IF NOT EXISTS idx_embeddings_chunk  ON embeddings(chunk_id);
    CREATE INDEX IF NOT EXISTS idx_graph_from        ON graph_edges(from_chunk);
    CREATE INDEX IF NOT EXISTS idx_graph_project     ON graph_edges(project_id);
    CREATE INDEX IF NOT EXISTS idx_memories_project  ON memories(project_id, created_at DESC);
  `);
}
