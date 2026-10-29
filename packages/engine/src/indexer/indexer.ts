import { readdirSync, readFileSync, statSync } from "fs";
import { spawnSync } from "child_process";
import { createHash } from "crypto";
import { join, relative, extname, resolve, sep } from "path";
import Parser from "web-tree-sitter";
import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "crypto";
import { v5 as uuidv5 } from "uuid";
import type { GraphEdge } from "../types.js";
import { loadLanguage, getLanguageForFile, initTreeSitter } from "./languages.js";
import { extractImports } from "./chunker.js";
import { parseFile, parseInChild, parsesOutOfProcess, type ParsedFile } from "./parse.js";
import { ImportResolver, resolveFileImports, type ImportEdge } from "./imports.js";
import {
  upsertFile,
  getFileHash,
  deleteFile,
  insertChunks,
  replaceFileSymbols,
  getProjectFiles,
  upsertProject,
  markProjectIndexed,
  getFileRepresentativeChunk,
  deleteProjectGraphEdges,
  insertGraphEdges,
  replaceFileImports,
} from "../storage/sqlite.js";

const UUID_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8"; // UUID v5 URL namespace

const IGNORE_DIRS = new Set([
  "node_modules", ".git", "__pycache__", "dist", "build", ".context-pilot",
  ".next", "coverage", ".venv", "venv", ".env",
]);

const SUPPORTED_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".php", ".html", ".htm", ".css", ".swift", ".cs"]);

/**
 * Stable id for a project root. The same folder must map to the same id however
 * it is spelled: "C:\repo", "C:/repo/" and "c:\repo" are one project on Windows.
 */
export function projectId(rootPath: string): string {
  let key = resolve(rootPath).split(sep).join("/").replace(/\/+$/, "");
  if (process.platform === "win32") key = key.toLowerCase();
  return uuidv5(key, UUID_NAMESPACE);
}

function hashFile(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/** Files git tracks or would track (respects .gitignore, skips worktrees); null outside a repo. */
function gitFiles(dir: string): string[] | null {
  const r = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: dir,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.status !== 0) return null;
  return r.stdout
    .split("\0")
    .filter((f) => f && SUPPORTED_EXTS.has(extname(f).toLowerCase()))
    .filter((f) => !f.split("/").some((part) => IGNORE_DIRS.has(part) || (part.startsWith(".") && part !== ".github")))
    .map((f) => join(dir, f));
}

function collectFiles(dir: string): string[] {
  const tracked = gitFiles(dir);
  if (tracked) return tracked;
  const files: string[] = [];

  function walk(current: string): void {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }
    for (const entry of entries) {
      // Hidden folders hold tooling, caches and agent worktrees (copies of the repo)
      if (IGNORE_DIRS.has(entry) || (entry.startsWith(".") && entry !== ".github")) continue;
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
 * Parses the given files and resolves their imports to file-level edges.
 * Reads source files only — no database access — so it can run read-only.
 */
export async function extractImportGraph(projectPath: string, absFiles: string[]): Promise<ImportEdge[]> {
  await initTreeSitter();
  const relOf = (abs: string): string => toRel(projectPath, abs);
  const resolver = new ImportResolver(absFiles.map(relOf));
  const parser = new Parser();
  const edges: ImportEdge[] = [];

  for (const absPath of absFiles) {
    const lang = getLanguageForFile(absPath);
    if (!lang || !IMPORT_LANGS.has(lang)) continue;

    let source: string;
    try { source = readFileSync(absPath, "utf8"); } catch { continue; }

    try {
      parser.setLanguage(await loadLanguage(lang));
      const tree = parser.parse(source);
      edges.push(...resolveFileImports(resolver, relOf(absPath), lang, extractImports(source, lang, tree)));
      tree.delete();
    } catch {
      // ignore parse errors in graph building
    }
  }
  return edges;
}

/** Scans a project from disk and returns its import graph (read-only). */
export async function scanImportGraph(projectPath: string): Promise<{ files: string[]; edges: ImportEdge[] }> {
  const absFiles = collectFiles(projectPath);
  const edges = await extractImportGraph(projectPath, absFiles);
  return { files: absFiles.map((f) => toRel(projectPath, f)), edges };
}

function toRel(projectPath: string, absPath: string): string {
  return relative(projectPath, absPath).split(sep).join("/");
}

/**
 * Second pass: store file-level import edges, plus chunk-level edges between
 * each file's representative chunk (used by get_graph).
 */
async function buildGraphEdges(
  db: DatabaseSync,
  pid: string,
  projectPath: string,
  allFiles: string[]
): Promise<void> {
  const fileEdges = await extractImportGraph(projectPath, allFiles);
  replaceFileImports(db, pid, fileEdges);

  const pathToFileId = new Map(getProjectFiles(db, pid).map((f) => [f.path, f.id]));
  const chunkOf = (path: string): string | undefined => {
    const fileId = pathToFileId.get(path);
    return fileId ? getFileRepresentativeChunk(db, fileId) : undefined;
  };

  deleteProjectGraphEdges(db, pid);
  const edges: GraphEdge[] = [];
  for (const e of fileEdges) {
    const from = chunkOf(e.from);
    const to = chunkOf(e.to);
    if (from && to && from !== to) edges.push({ from, to, edgeType: "imports", weight: 1.0 });
  }
  if (edges.length > 0) insertGraphEdges(db, pid, edges);
}

/** Languages with import rules: only these are parsed for the import graph */
const IMPORT_LANGS = new Set(["javascript", "typescript", "tsx", "python", "php", "html", "css"]);

function storeFile(
  db: DatabaseSync,
  pid: string,
  absPath: string,
  relPath: string,
  lang: NonNullable<ReturnType<typeof getLanguageForFile>>,
  hash: string,
  fileId: string,
  parsed: ParsedFile
): void {
  // Drop the old row first: its chunks reference the old file id
  deleteFile(db, pid, relPath);
  upsertFile(db, fileId, pid, relPath, lang, hash, statSync(absPath).mtimeMs);
  insertChunks(db, parsed.chunks);
  replaceFileSymbols(db, pid, relPath, parsed.symbols, parsed.refs);
}

async function indexFile(
  db: DatabaseSync,
  pid: string,
  absPath: string,
  relPath: string,
  lang: NonNullable<ReturnType<typeof getLanguageForFile>>,
  source: string,
  hash: string
): Promise<void> {
  const fileId = randomUUID();
  const parsed = await parseFile({ lang, source, fileId });
  if (!parsed) throw new Error("could not parse");
  storeFile(db, pid, absPath, relPath, lang, hash, fileId, parsed);
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
  const deferred: { absPath: string; relPath: string; lang: NonNullable<ReturnType<typeof getLanguageForFile>>; source: string; hash: string; fileId: string }[] = [];

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

    if (parsesOutOfProcess(lang)) {
      deferred.push({ absPath, relPath, lang, source, hash, fileId: randomUUID() });
      continue;
    }

    try {
      await indexFile(db, pid, absPath, relPath, lang, source, hash);
    } catch (err) {
      process.stderr.write(`[engine] failed to index ${relPath}: ${err}\n`);
      filesSkipped++;
      continue;
    }

    filesIndexed++;
  }

  // Swift / C# on Node 25+: one child process for all of them
  const parsed = parseInChild(deferred.map((d) => ({ lang: d.lang, source: d.source, fileId: d.fileId })));
  deferred.forEach((d, i) => {
    const p = parsed[i];
    if (!p) {
      process.stderr.write(`[engine] failed to index ${d.relPath}\n`);
      filesSkipped++;
      return;
    }
    storeFile(db, pid, d.absPath, d.relPath, d.lang, d.hash, d.fileId, p);
    filesIndexed++;
  });

  // Files that are gone from disk
  const present = new Set(allFiles.map((f) => toRel(projectPath, f)));
  for (const f of getProjectFiles(db, pid)) if (!present.has(f.path)) deleteFile(db, pid, f.path);

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
      deleteFile(db, pid, relPath);
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
      await indexFile(db, pid, absPath, relPath, lang, source, hash);
    } catch (err) {
      process.stderr.write(`[engine] failed to index ${relPath}: ${err}\n`);
      filesSkipped++;
      continue;
    }

    filesIndexed++;
  }

  return { filesIndexed, filesSkipped, totalFiles: absPaths.length };
}
