import { headSha, isGitRepo, readGitLog, type GitCommit } from "./git.js";
import {
  combineCoChanges,
  commitWeight,
  defaultIgnore,
  DEFAULT_MAX_FILES_PER_COMMIT,
  DEFAULT_MIN_CONFIDENCE,
  DEFAULT_MIN_SUPPORT,
  DEFAULT_SHRINKAGE,
  mineCommits,
  pairKey,
  type CoChangeResult,
  type CombineMethod,
  type FileStats,
  type PairStats,
} from "./cochange.js";
import { computeImpact } from "../impact/impact.js";
import type { ImportEdge } from "../indexer/imports.js";
import { scanImportGraph } from "../indexer/indexer.js";

export const DEFAULT_TEST_COMMITS = 200;
export const DEFAULT_TRAIN_COMMITS = 5000;
export const DEFAULT_BACKTEST_KS = [5, 10];

export interface BacktestOptions {
  /** Newest N commits are the test set; everything older is training (default 200) */
  testCommits?: number;
  /** Cut-offs for precision/recall/hit-rate (default [5, 10]) */
  ks?: number[];
  /**
   * Files per query. 1 (default): every file of a test commit is queried on its own.
   * q > 1: the first q files of the commit (git order) are queried together.
   */
  queryFiles?: number;
  minSupport?: number;
  minConfidence?: number;
  combine?: CombineMethod;
  shrinkage?: number;
  /** true (default): each test commit is added to the model after being evaluated */
  walkForward?: boolean;
  maxFilesPerCommit?: number;
  ignore?: (path: string) => boolean;
  /**
   * Import graph to combine with co-changes (impact scoring). It is the graph
   * as of today, not as of each test commit: a mild leak, fine for comparing
   * configurations but slightly optimistic in absolute terms.
   */
  graph?: { edges: ImportEdge[]; files: string[] };
}

export interface BacktestMetrics {
  k: number;
  /** Mean of hits / |top k|, over queries that returned at least one prediction */
  precision: number;
  /** Mean of hits / |rest of the commit| */
  recall: number;
  /** Share of queries with at least one hit in the top k */
  hitRate: number;
}

export interface BacktestReport {
  options: {
    testCommits: number;
    queryFiles: number;
    minSupport: number;
    minConfidence: number;
    combine: CombineMethod;
    shrinkage: number;
    walkForward: boolean;
    ks: number[];
    withGraph: boolean;
  };
  headSha?: string;
  trainCommits: number;
  testCommits: number;
  /** Test commits with enough eligible files to be evaluated */
  evaluatedCommits: number;
  skipped: { bulk: number; tooFewFiles: number };
  queries: number;
  /** Evaluated commits where at least one eligible file had history */
  coverage: number;
  /** Queries that returned at least one prediction */
  answered: number;
  /** Metrics are averaged per commit first, then across commits */
  metrics: BacktestMetrics[];
}

/** Mutable co-change model used while walking forward through the test commits. */
class Model {
  files: Map<string, FileStats>;
  adj = new Map<string, Map<string, PairStats>>();
  dead = new Set<string>();

  constructor(files: Map<string, FileStats>, pairs: Iterable<PairStats>, dead: Set<string>) {
    this.files = files;
    this.dead = dead;
    for (const p of pairs) this.link(p);
  }

  private link(p: PairStats): void {
    for (const [a, b] of [[p.fileA, p.fileB], [p.fileB, p.fileA]]) {
      let m = this.adj.get(a);
      if (!m) this.adj.set(a, (m = new Map()));
      m.set(b, p);
    }
  }

  predict(
    sources: string[],
    opts: Required<Pick<BacktestOptions, "minSupport" | "minConfidence" | "combine" | "shrinkage">>
  ): CoChangeResult[] {
    const known = sources.filter((s) => this.files.has(s));
    const sourceSet = new Set(sources);
    const rows = known.flatMap((source) =>
      [...(this.adj.get(source) ?? [])].map(([candidate, p]) => ({
        source,
        candidate,
        support: p.support,
        wsupport: p.wsupport,
        lastTs: p.lastTs,
      }))
    ).filter((r) => !sourceSet.has(r.candidate) && !this.dead.has(r.candidate));
    return combineCoChanges(rows, this.files, { ...opts, sourceCount: known.length });
  }

  /** Moves all history of `from` to `to`, as the miner does for renames. */
  rename(from: string, to: string): void {
    const fs = this.files.get(from);
    if (fs) {
      this.files.delete(from);
      const existing = this.files.get(to);
      if (existing) {
        existing.commits += fs.commits;
        existing.wcommits += fs.wcommits;
        existing.lastTs = Math.max(existing.lastTs, fs.lastTs);
      } else {
        this.files.set(to, { ...fs, path: to });
      }
    }
    const partners = this.adj.get(from);
    if (!partners) return;
    this.adj.delete(from);
    for (const [partner, p] of partners) {
      this.adj.get(partner)?.delete(from);
      if (partner === to) continue;
      const [a, b] = pairKey(to, partner);
      const existing = this.adj.get(to)?.get(partner);
      if (existing) {
        existing.support += p.support;
        existing.wsupport += p.wsupport;
        existing.lastTs = Math.max(existing.lastTs, p.lastTs);
      } else {
        this.link({ ...p, fileA: a, fileB: b });
      }
    }
  }

  add(paths: string[], timestamp: number): void {
    const w = commitWeight(timestamp);
    for (const path of paths) {
      const s = this.files.get(path);
      if (s) {
        s.commits++;
        s.wcommits += w;
        s.lastTs = Math.max(s.lastTs, timestamp);
      } else {
        this.files.set(path, { path, commits: 1, wcommits: w, lastTs: timestamp });
      }
    }
    for (let i = 0; i < paths.length; i++) {
      for (let j = i + 1; j < paths.length; j++) {
        const p = this.adj.get(paths[i])?.get(paths[j]);
        if (p) {
          p.support++;
          p.wsupport += w;
          p.lastTs = Math.max(p.lastTs, timestamp);
        } else {
          const [a, b] = pairKey(paths[i], paths[j]);
          this.link({ fileA: a, fileB: b, support: 1, wsupport: w, lastTs: timestamp });
        }
      }
    }
  }
}

/** Files deleted (or renamed away) as of the newest commit of a newest-first list. */
function deadFiles(commitsNewestFirst: GitCommit[]): Set<string> {
  const dead = new Set<string>();
  for (let i = commitsNewestFirst.length - 1; i >= 0; i--) applyLifecycle(dead, commitsNewestFirst[i]);
  return dead;
}

function applyLifecycle(dead: Set<string>, commit: GitCommit): void {
  for (const f of commit.files) {
    if (f.status === "D") dead.add(f.path);
    else dead.delete(f.path);
    if (f.status === "R" && f.oldPath && f.oldPath !== f.path) dead.add(f.oldPath);
  }
}

const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

/**
 * Replays history to measure how well co-changes predict the rest of a commit.
 * Pure: `commits` newest-first (git log order). Each test commit is predicted from
 * strictly older commits only, using the paths as they were before that commit.
 * Files added by a test commit can never be predicted from history, so they are
 * excluded from both queries and targets.
 */
export function backtestCoChanges(commits: GitCommit[], options: BacktestOptions = {}): BacktestReport {
  const testCount = Math.min(options.testCommits ?? DEFAULT_TEST_COMMITS, commits.length);
  const ks = options.ks ?? DEFAULT_BACKTEST_KS;
  const queryFiles = Math.max(1, options.queryFiles ?? 1);
  const scoring = {
    minSupport: options.minSupport ?? DEFAULT_MIN_SUPPORT,
    minConfidence: options.minConfidence ?? DEFAULT_MIN_CONFIDENCE,
    combine: options.combine ?? "noisy-or",
    shrinkage: options.shrinkage ?? DEFAULT_SHRINKAGE,
  } as const;
  const walkForward = options.walkForward ?? true;
  const maxFiles = options.maxFilesPerCommit ?? DEFAULT_MAX_FILES_PER_COMMIT;
  const ignore = options.ignore ?? defaultIgnore;

  const test = commits.slice(0, testCount).reverse();
  const train = commits.slice(testCount);
  const mined = mineCommits(train, { maxFilesPerCommit: maxFiles, ignore });
  const model = new Model(mined.files, mined.pairs.values(), deadFiles(train));

  const skipped = { bulk: 0, tooFewFiles: 0 };
  const perCommit: Array<{ covered: boolean; queries: number; answered: number; byK: BacktestMetrics[] }> = [];

  for (const commit of test) {
    const touched = commit.files.filter((f) => f.status !== "D" && !ignore(f.path));
    const bulk = touched.length === 0 || touched.length > maxFiles;

    if (bulk) {
      skipped.bulk++;
    } else {
      // Paths as the model knows them: before this commit's own renames
      const eligible = [
        ...new Set(touched.filter((f) => f.status !== "A").map((f) => (f.status === "R" && f.oldPath) || f.path)),
      ];
      const queries =
        queryFiles === 1 ? eligible.map((f) => [f]) : eligible.length > queryFiles ? [eligible.slice(0, queryFiles)] : [];

      if (eligible.length < 2 || queries.length === 0) {
        skipped.tooFewFiles++;
      } else {
        const results = queries.map((q) => {
          const targets = new Set(eligible.filter((f) => !q.includes(f)));
          const coChanges = model.predict(q, scoring);
          const predicted = options.graph
            ? computeImpact({ changed: q, coChanges, imports: options.graph.edges, files: options.graph.files })
                .map((r) => r.path)
                .filter((p) => !model.dead.has(p))
            : coChanges.map((r) => r.path);
          return ks.map((k) => {
            const top = predicted.slice(0, k);
            const hits = top.filter((p) => targets.has(p)).length;
            return { k, answered: top.length > 0, precision: top.length ? hits / top.length : 0, recall: hits / targets.size, hit: hits > 0 };
          });
        });
        perCommit.push({
          covered: eligible.some((f) => model.files.has(f)),
          queries: queries.length,
          answered: results.filter((r) => r[0].answered).length,
          byK: ks.map((k, i) => {
            const rs = results.map((r) => r[i]);
            const answered = rs.filter((r) => r.answered);
            return {
              k,
              precision: answered.length ? mean(answered.map((r) => r.precision)) : NaN,
              recall: mean(rs.map((r) => r.recall)),
              hitRate: mean(rs.map((r) => (r.hit ? 1 : 0))),
            };
          }),
        });
      }
    }

    if (walkForward) {
      for (const f of commit.files) {
        if (f.status === "R" && f.oldPath && f.oldPath !== f.path) model.rename(f.oldPath, f.path);
      }
      applyLifecycle(model.dead, commit);
      if (!bulk) model.add([...new Set(touched.map((f) => f.path))], commit.timestamp);
    }
  }

  return {
    options: { testCommits: testCount, queryFiles, ...scoring, walkForward, ks, withGraph: !!options.graph },
    trainCommits: train.length,
    testCommits: test.length,
    evaluatedCommits: perCommit.length,
    skipped,
    queries: perCommit.reduce((a, c) => a + c.queries, 0),
    coverage: mean(perCommit.map((c) => (c.covered ? 1 : 0))),
    answered: perCommit.reduce((a, c) => a + c.answered, 0),
    metrics: ks.map((k, i) => ({
      k,
      precision: mean(perCommit.map((c) => c.byK[i].precision).filter((x) => !Number.isNaN(x))),
      recall: mean(perCommit.map((c) => c.byK[i].recall)),
      hitRate: mean(perCommit.map((c) => c.byK[i].hitRate)),
    })),
  };
}

/**
 * Backtests a repository's history. Read-only: only runs `git rev-parse` and
 * `git log` (plus reading source files with `withGraph`), and touches neither
 * the working tree nor the context-pilot database.
 */
export async function backtestRepo(
  projectPath: string,
  options: BacktestOptions & { maxTrainCommits?: number; withGraph?: boolean } = {}
): Promise<BacktestReport> {
  if (!(await isGitRepo(projectPath))) throw new Error(`Not a git repository: ${projectPath}`);
  const head = await headSha(projectPath);
  if (!head) throw new Error(`Repository has no commits: ${projectPath}`);

  const testCommits = options.testCommits ?? DEFAULT_TEST_COMMITS;
  const commits = await readGitLog(projectPath, {
    range: head,
    maxCommits: testCommits + (options.maxTrainCommits ?? DEFAULT_TRAIN_COMMITS),
  });
  const graph = options.withGraph ? await scanImportGraph(projectPath) : options.graph;
  return { ...backtestCoChanges(commits, { ...options, graph }), headSha: head };
}
