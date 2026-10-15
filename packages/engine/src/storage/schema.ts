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


    CREATE TABLE IF NOT EXISTS graph_edges (
      id         TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      from_chunk TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
      to_chunk   TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
      edge_type  TEXT NOT NULL,
      weight     REAL DEFAULT 1.0
    );

    CREATE INDEX IF NOT EXISTS idx_chunks_file       ON chunks(file_id);
    CREATE INDEX IF NOT EXISTS idx_files_project     ON files(project_id);
    CREATE INDEX IF NOT EXISTS idx_graph_from        ON graph_edges(from_chunk);
    CREATE INDEX IF NOT EXISTS idx_graph_project     ON graph_edges(project_id);

    -- File-level import graph (project-relative paths): from_path imports to_path
    CREATE TABLE IF NOT EXISTS file_imports (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      from_path  TEXT NOT NULL,
      to_path    TEXT NOT NULL,
      PRIMARY KEY (project_id, from_path, to_path)
    );

    CREATE INDEX IF NOT EXISTS idx_file_imports_to ON file_imports(project_id, to_path);

    -- Co-change statistics mined from git history (paths relative to project root).
    -- Weights use a fixed-epoch exponential decay, see history/cochange.ts.
    CREATE TABLE IF NOT EXISTS cochange_files (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      path       TEXT NOT NULL,
      commits    INTEGER NOT NULL,
      wcommits   REAL NOT NULL,
      last_ts    INTEGER NOT NULL,
      PRIMARY KEY (project_id, path)
    );

    CREATE TABLE IF NOT EXISTS cochange_pairs (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      file_a     TEXT NOT NULL,
      file_b     TEXT NOT NULL,
      support    INTEGER NOT NULL,
      wsupport   REAL NOT NULL,
      last_ts    INTEGER NOT NULL,
      PRIMARY KEY (project_id, file_a, file_b)
    );

    CREATE INDEX IF NOT EXISTS idx_cochange_b ON cochange_pairs(project_id, file_b);

    CREATE TABLE IF NOT EXISTS cochange_state (
      project_id        TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      head_sha          TEXT NOT NULL,
      commits_processed INTEGER NOT NULL,
      commits_skipped   INTEGER NOT NULL,
      mined_at          INTEGER NOT NULL
    );
  `);
}
