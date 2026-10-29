import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import Parser from "web-tree-sitter";
import type { Chunk } from "../types.js";
import { extractChunks } from "./chunker.js";
import { initTreeSitter, loadLanguage, type Lang } from "./languages.js";
import { extractSymbols, type SymbolDef, type SymbolRef } from "../symbols/extract.js";

// Parsing one file into what the index stores. Swift and C# grammars are large
// enough that Node 25's optimizing wasm compiler runs out of zone memory and
// kills the process; there they are parsed in a child Node with --liftoff-only.

export interface ParsedFile {
  chunks: Chunk[];
  symbols: SymbolDef[];
  refs: SymbolRef[];
}

export interface ParseJob {
  lang: Lang;
  source: string;
  fileId: string;
}

/** Grammars that need --liftoff-only on Node 25+ */
const BIG_GRAMMARS = new Set<Lang>(["swift", "csharp"]);

export function parsesOutOfProcess(lang: Lang): boolean {
  const major = Number(process.versions.node.split(".")[0]);
  return BIG_GRAMMARS.has(lang) && major >= 25 && !process.execArgv.includes("--liftoff-only");
}

export async function parseInProcess(job: ParseJob): Promise<ParsedFile> {
  await initTreeSitter();
  const parser = new Parser();
  parser.setLanguage(await loadLanguage(job.lang));
  const tree = parser.parse(job.source);
  try {
    return { chunks: extractChunks(job.source, job.fileId, job.lang, tree), ...extractSymbols(job.lang, tree) };
  } finally {
    tree.delete();
    parser.delete();
  }
}

const here = dirname(fileURLToPath(import.meta.url));
// Next to this file once built; from src/ (tests), the built copy
const childScript = [join(here, "parse-child.js"), join(here, "..", "..", "dist", "indexer", "parse-child.js")].find((p) => existsSync(p)) ?? join(here, "parse-child.js");
const MAX_CHILD_INPUT = 64 * 1024 * 1024;

/** Parses jobs in a child Node with --liftoff-only. A failed job comes back as null. */
export function parseInChild(jobs: ParseJob[]): (ParsedFile | null)[] {
  if (jobs.length === 0) return [];
  // Keep each child's input bounded
  const batches: ParseJob[][] = [[]];
  let size = 0;
  for (const j of jobs) {
    if (size + j.source.length > MAX_CHILD_INPUT / 2 && batches[batches.length - 1].length) {
      batches.push([]);
      size = 0;
    }
    batches[batches.length - 1].push(j);
    size += j.source.length;
  }
  const out: (ParsedFile | null)[] = [];
  for (const batch of batches) {
    const r = spawnSync(process.execPath, ["--liftoff-only", childScript], {
      input: JSON.stringify(batch),
      encoding: "utf8",
      maxBuffer: MAX_CHILD_INPUT * 4,
    });
    try {
      if (r.status !== 0) throw new Error(r.stderr || `exit ${r.status}`);
      out.push(...(JSON.parse(r.stdout) as (ParsedFile | null)[]));
    } catch (err) {
      process.stderr.write(`[engine] parser child failed: ${String(err).slice(0, 300)}\n`);
      out.push(...batch.map(() => null));
    }
  }
  return out;
}

/** Parses a file in this process, or in a child when its grammar needs it. */
export async function parseFile(job: ParseJob): Promise<ParsedFile | null> {
  return parsesOutOfProcess(job.lang) ? parseInChild([job])[0] : parseInProcess(job);
}
