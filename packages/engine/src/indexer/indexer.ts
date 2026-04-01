import { readdirSync, readFileSync, statSync } from "fs";
import { createHash } from "crypto";
import { join, relative, extname } from "path";
import Parser from "web-tree-sitter";
import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "crypto";
import { v5 as uuidv5 } from "uuid";
import type { Chunk } from "../types.js";
import { loadLanguage, getLanguageForFile, initTreeSitter } from "./languages.js";
import { extractChunks } from "./chunker.js";
import {
  upsertFile,
  getFileHash,
  deleteFileChunks,
  insertChunks,
  getProjectFiles,
  upsertProject,
  markProjectIndexed,
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

    let chunks: Chunk[];
    try {
      const language = await loadLanguage(lang);
      const parser = new Parser();
      parser.setLanguage(language);
      const tree = parser.parse(source);

      const stat = statSync(absPath);
      const fileId = randomUUID();

      upsertFile(db, fileId, pid, relPath, lang, hash, stat.mtimeMs);
      deleteFileChunks(db, fileId);

      chunks = extractChunks(source, fileId, lang, tree);
      insertChunks(db, chunks);
    } catch (err) {
      process.stderr.write(`[engine] failed to index ${relPath}: ${err}\n`);
      filesSkipped++;
      continue;
    }

    filesIndexed++;
  }

  markProjectIndexed(db, pid);
  return { filesIndexed, filesSkipped, totalFiles: allFiles.length };
}
