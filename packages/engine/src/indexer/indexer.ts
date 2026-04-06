import { readdirSync, readFileSync, statSync } from "fs";
import { createHash } from "crypto";
import { join, relative, extname } from "path";
import Parser from "web-tree-sitter";
import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "crypto";
import { v5 as uuidv5 } from "uuid";
import type { Chunk } from "../types.js";
import { loadLanguage, getLanguageForFile, initTreeSitter } from "./languages.js";
import { extractChunks, extractImports } from "./chunker.js";
import {
  upsertFile,
  getFileHash,
  deleteFileChunks,
  insertChunks,
  getProjectFiles,
  upsertProject,
  markProjectIndexed,
  getFileRepresentativeChunk,
  deleteProjectGraphEdges,
  insertGraphEdges,
} from "../storage/sqlite.js";

const UUID_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8"; // UUID v5 URL namespace

const IGNORE_DIRS = new Set([
  "node_modules", ".git", "__pycache__", "dist", "build", ".context-pilot",
  ".next", "coverage", ".venv", "venv", ".env",
]);

const SUPPORTED_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".py"]);

export function projectId(rootPath: string): string {
  return uuidv5(rootPath, UUID_NAMESPACE);
}

function hashFile(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function collectFiles(dir: string): string[] {
  const files: string[] = [];

  function walk(current: string): void {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry)) continue;
      const full = join(current, entry);
      let stat;
      try { stat = statSync(full); } catch { continue; }
      if (stat.isDirectory()) {
        walk(full);
      } else if (SUPPORTED_EXTS.has(extname(full).toLowerCase())) {
        files.push(full);
      }
    }
  }

  walk(dir);
  return files;
}

/**
 * Resolve a relative import path to candidate relative file paths within the project.
 * Returns multiple candidates (with different extensions) for the caller to match.
 */
function resolveImportCandidates(importPath: string, fromRelDir: string): string[] {
  if (!importPath.startsWith(".")) return []; // external module

  const base = join(fromRelDir, importPath).replace(/\\/g, "/");
  return [
    base + ".ts",
    base + ".tsx",
    base + ".js",
    base + ".jsx",
    base + "/index.ts",
    base + "/index.tsx",
    base + "/index.js",
    base,
  ];
}

/**
 * Second pass: extract import edges and store them in graph_edges.
 * Replaces all existing graph edges for the project.
 */
async function buildGraphEdges(
  db: DatabaseSync,
  pid: string,
  projectPath: string,
  allFiles: string[]
): Promise<void> {
  const projectFiles = getProjectFiles(db, pid);
  const pathToFileId = new Map(projectFiles.map((f) => [f.path, f.id]));

  deleteProjectGraphEdges(db, pid);

  const edges: Array<{ from: string; to: string; edgeType: "calls" | "extends" | "imports"; weight: number }> = [];

  for (const absPath of allFiles) {
    const relPath = relative(projectPath, absPath).replace(/\\/g, "/");
    const fileId = pathToFileId.get(relPath);
    if (!fileId) continue;

    const fromChunkId = getFileRepresentativeChunk(db, fileId);
    if (!fromChunkId) continue;

    const lang = getLanguageForFile(absPath);
    if (!lang) continue;

    let source: string;
    try { source = readFileSync(absPath, "utf8"); } catch { continue; }

    try {
      const language = await loadLanguage(lang);
      const parser = new Parser();
      parser.setLanguage(language);
      const tree = parser.parse(source);
      const imports = extractImports(source, lang, tree);
      const fromRelDir = relPath.includes("/") ? relPath.slice(0, relPath.lastIndexOf("/")) : ".";

      for (const imp of imports) {
        const candidates = resolveImportCandidates(imp.to, fromRelDir);
        for (const candidate of candidates) {
          const targetFileId = pathToFileId.get(candidate);
          if (!targetFileId) continue;
          const toChunkId = getFileRepresentativeChunk(db, targetFileId);
          if (!toChunkId) continue;
          if (fromChunkId !== toChunkId) {
            edges.push({ from: fromChunkId, to: toChunkId, edgeType: "imports", weight: 1.0 });
          }
          break; // found a match, stop trying candidates
        }
      }
    } catch {
      // ignore parse errors in graph building
    }
  }

  if (edges.length > 0) {
    insertGraphEdges(db, pid, edges);
  }
}

export async function indexProject(
  db: DatabaseSync,
  projectPath: string,
  force: boolean
): Promise<{ filesIndexed: number; filesSkipped: number; totalFiles: number }> {
  const pid = projectId(projectPath);
  upsertProject(db, pid, projectPath);

  await initTreeSitter();

  const allFiles = collectFiles(projectPath);
  let filesIndexed = 0;
  let filesSkipped = 0;

  for (const absPath of allFiles) {
    const relPath = relative(projectPath, absPath).replace(/\\/g, "/");
    let source: string;
    try {
      source = readFileSync(absPath, "utf8");
    } catch {
      filesSkipped++;
      continue;
    }

    const hash = hashFile(source);
    const existingHash = getFileHash(db, pid, relPath);

    if (!force && existingHash === hash) {
      filesSkipped++;
      continue;
    }

    const lang = getLanguageForFile(absPath);
    if (!lang) {
      filesSkipped++;
      continue;
    }

    try {
      const language = await loadLanguage(lang);
      const parser = new Parser();
      parser.setLanguage(language);
      const tree = parser.parse(source);

      const stat = statSync(absPath);
      const fileId = randomUUID();

      upsertFile(db, fileId, pid, relPath, lang, hash, stat.mtimeMs);
      deleteFileChunks(db, fileId);

      const chunks = extractChunks(source, fileId, lang, tree);
      insertChunks(db, chunks);
    } catch (err) {
      process.stderr.write(`[engine] failed to index ${relPath}: ${err}\n`);
      filesSkipped++;
      continue;
    }

    filesIndexed++;
  }

  // Build import graph after all files are indexed
  await buildGraphEdges(db, pid, projectPath, allFiles);

  markProjectIndexed(db, pid);
  return { filesIndexed, filesSkipped, totalFiles: allFiles.length };
}

/**
 * Re-index only specific files (used by the file watcher).
 * Does NOT rebuild graph edges — call indexProject for a full rebuild.
 */
export async function indexSpecificFiles(
  db: DatabaseSync,
  projectPath: string,
  absPaths: string[],
  force: boolean
): Promise<{ filesIndexed: number; filesSkipped: number; totalFiles: number }> {
  const pid = projectId(projectPath);
  upsertProject(db, pid, projectPath);

  await initTreeSitter();

  let filesIndexed = 0;
  let filesSkipped = 0;

  for (const absPath of absPaths) {
    if (!SUPPORTED_EXTS.has(extname(absPath).toLowerCase())) {
      filesSkipped++;
      continue;
    }

    const relPath = relative(projectPath, absPath).replace(/\\/g, "/");
    let source: string;
    try {
      source = readFileSync(absPath, "utf8");
    } catch {
      // File deleted — remove from index
      const existing = db
        .prepare(`SELECT id FROM files WHERE project_id = ? AND path = ?`)
        .get(pid, relPath) as { id: string } | undefined;
      if (existing) {
        deleteFileChunks(db, existing.id);
        db.prepare(`DELETE FROM files WHERE id = ?`).run(existing.id);
      }
      filesSkipped++;
      continue;
    }

    const hash = hashFile(source);
    const existingHash = getFileHash(db, pid, relPath);

    if (!force && existingHash === hash) {
      filesSkipped++;
      continue;
    }

    const lang = getLanguageForFile(absPath);
    if (!lang) {
      filesSkipped++;
      continue;
    }

    try {
      const language = await loadLanguage(lang);
      const parser = new Parser();
      parser.setLanguage(language);
      const tree = parser.parse(source);

      const stat = statSync(absPath);
      const fileId = randomUUID();

      upsertFile(db, fileId, pid, relPath, lang, hash, stat.mtimeMs);
      deleteFileChunks(db, fileId);

      const chunks = extractChunks(source, fileId, lang, tree);
      insertChunks(db, chunks);
    } catch (err) {
      process.stderr.write(`[engine] failed to index ${relPath}: ${err}\n`);
      filesSkipped++;
      continue;
    }

    filesIndexed++;
  }

  return { filesIndexed, filesSkipped, totalFiles: absPaths.length };
}
