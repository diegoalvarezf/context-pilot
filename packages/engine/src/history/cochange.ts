import type { GitCommit } from "./git.js";

/**
 * Recency weighting: a commit's weight doubles every HALF_LIFE seconds, measured
 * from a fixed epoch. Because the reference point is fixed, weights stored today
 * stay comparable with weights added by later incremental runs, and ratios
 * (confidence) never need re-normalizing.
 */
export const DECAY_EPOCH = 1_600_000_000; // 2020-09-13
export const HALF_LIFE_SECONDS = 180 * 24 * 3600;

export function commitWeight(timestamp: number): number {
  return Math.pow(2, (timestamp - DECAY_EPOCH) / HALF_LIFE_SECONDS);
}

export interface FileStats {
  path: string;
  commits: number;
  wcommits: number;
  lastTs: number;
}

export interface PairStats {
  fileA: string;
  fileB: string;
  support: number;
  wsupport: number;
  lastTs: number;
}

export interface MineOptions {
  /** Commits touching more files than this (after ignores) are bulk changes: skipped */
  maxFilesPerCommit?: number;
  ignore?: (path: string) => boolean;
}

export interface MineResult {
  files: Map<string, FileStats>;
  pairs: Map<string, PairStats>;
  commitsProcessed: number;
  commitsSkipped: number;
  renames: number;
}

export const DEFAULT_MAX_FILES_PER_COMMIT = 30;

const IGNORED_BASENAMES = new Set([
  "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "composer.lock",
  "poetry.lock", "Pipfile.lock", "Cargo.lock", "Gemfile.lock", "go.sum", "uv.lock",
  ".DS_Store", "Thumbs.db",
]);
const IGNORED_DIRS = /(^|\/)(node_modules|dist|build|out|coverage|vendor|\.next|__pycache__|\.context-pilot)\//;
const IGNORED_FILES = /(\.min\.(js|css)|\.map|\.snap)$|(^|\/)CHANGELOG[^/]*$/i;

export function defaultIgnore(path: string): boolean {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return IGNORED_BASENAMES.has(base) || IGNORED_DIRS.test(path) || IGNORED_FILES.test(path);
}

export function pairKey(a: string, b: string): [string, string, string] {
  const [x, y] = a < b ? [a, b] : [b, a];
  return [x, y, `${x}\0${y}`];
}

/**
 * Aggregates per-file and per-pair co-change statistics.
 * `commits` must be ordered newest-first (git log order): renames are resolved
 * so that older commits are attributed to the file's current name.
 */
export function mineCommits(commits: GitCommit[], opts: MineOptions = {}): MineResult {
  const maxFiles = opts.maxFilesPerCommit ?? DEFAULT_MAX_FILES_PER_COMMIT;
  const ignore = opts.ignore ?? defaultIgnore;

  const alias = new Map<string, string>();
  const canonical = (p: string): string => {
    let current = p;
    for (let hops = 0; hops < 50 && alias.has(current); hops++) current = alias.get(current)!;
    return current;
  };

  const files = new Map<string, FileStats>();
  const pairs = new Map<string, PairStats>();
  let commitsProcessed = 0;
  let commitsSkipped = 0;
  let renames = 0;

  for (const commit of commits) {
    const touched = new Set<string>();
    for (const change of commit.files) {
      if (change.status === "D") continue;
      const path = canonical(change.path);
      if (!ignore(path)) touched.add(path);
    }

    // Register renames after attributing this commit: older commits use the old name
    for (const change of commit.files) {
      if (change.status === "R" && change.oldPath && change.oldPath !== change.path) {
        alias.set(change.oldPath, canonical(change.path));
        renames++;
      }
    }

    if (touched.size === 0 || touched.size > maxFiles) {
      commitsSkipped++;
      continue;
    }
    commitsProcessed++;

    const w = commitWeight(commit.timestamp);
    const list = [...touched];

    for (const path of list) {
      const s = files.get(path);
      if (s) {
        s.commits++;
        s.wcommits += w;
        s.lastTs = Math.max(s.lastTs, commit.timestamp);
      } else {
        files.set(path, { path, commits: 1, wcommits: w, lastTs: commit.timestamp });
      }
    }

    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const [a, b, key] = pairKey(list[i], list[j]);
        const p = pairs.get(key);
        if (p) {
          p.support++;
          p.wsupport += w;
          p.lastTs = Math.max(p.lastTs, commit.timestamp);
        } else {
          pairs.set(key, { fileA: a, fileB: b, support: 1, wsupport: w, lastTs: commit.timestamp });
        }
      }
    }
  }

  return { files, pairs, commitsProcessed, commitsSkipped, renames };
}

export interface CoChangeSource {
  file: string;
  support: number;
  /** Recency-weighted P(candidate changes | source changes) */
  confidence: number;
  sourceCommits: number;
}

export interface CoChangeResult {
  path: string;
  /** Noisy-OR of per-source confidences, in [0,1] */
  score: number;
  support: number;
  lastChangedTogether: number;
  sources: CoChangeSource[];
}

/**
 * Combines evidence from several changed files. A candidate that co-changes with
 * many of them scores higher than one tied to a single file (noisy-OR).
 */
export function combineCoChanges(
  rows: Array<{ source: string; candidate: string; support: number; wsupport: number; lastTs: number }>,
  sourceStats: Map<string, { commits: number; wcommits: number }>,
  opts: { minSupport: number; minConfidence: number }
): CoChangeResult[] {
  const byCandidate = new Map<string, CoChangeResult>();

  for (const row of rows) {
    const stats = sourceStats.get(row.source);
    if (!stats || stats.wcommits <= 0 || row.support < opts.minSupport) continue;
    const confidence = Math.min(1, row.wsupport / stats.wcommits);
    if (confidence < opts.minConfidence) continue;

    let entry = byCandidate.get(row.candidate);
    if (!entry) {
      entry = { path: row.candidate, score: 0, support: 0, lastChangedTogether: 0, sources: [] };
      byCandidate.set(row.candidate, entry);
    }
    entry.sources.push({ file: row.source, support: row.support, confidence, sourceCommits: stats.commits });
    entry.support += row.support;
    entry.lastChangedTogether = Math.max(entry.lastChangedTogether, row.lastTs);
  }

  for (const entry of byCandidate.values()) {
    entry.sources.sort((a, b) => b.confidence - a.confidence);
    entry.score = 1 - entry.sources.reduce((acc, s) => acc * (1 - s.confidence), 1);
  }

  return [...byCandidate.values()].sort((a, b) => b.score - a.score || b.support - a.support);
}
