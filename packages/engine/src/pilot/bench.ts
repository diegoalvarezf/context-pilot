import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { readGitLog, runGit } from "../history/git.js";
import { DEFAULT_MAX_FILES_PER_COMMIT, defaultIgnore } from "../history/cochange.js";
import { estimateTokens } from "./pilot.js";
import { terms } from "./search.js";
import type { IContextEngine, OutlineSymbol } from "../types.js";

// Does the pilot save tokens, and does it point at the right code? Replays past
// commits: the commit message is the task, the files it modified are the answer.
//
// Without context-pilot: the agent greps the task's terms and reads in full the
// files it ends up editing. With it: it gets the map, reads only the matched
// symbols' ranges of the files the map found, and greps + reads in full the
// ones the map missed.
//
// Caveat: the index and history are today's. The text search is fair (it only
// sees the code), but with `expand` the co-change history already contains the
// commit being tested, so treat that variant as an upper bound.

export interface BenchOptions {
  commits?: number;
  budget?: number;
  /** Expand search hits with impact (co-changes, imports): optimistic, see caveat */
  expand?: boolean;
  /** Lines kept per grep, like an agent piping to head */
  grepCap?: number;
  /**
   * Tasks to use instead of commit messages, by commit sha (or a prefix of it): e.g. the same
   * tasks translated to another language. Only those commits are evaluated.
   */
  tasks?: Record<string, string>;
}

export interface BenchCommit {
  sha: string;
  task: string;
  targets: string[];
  found: string[];
  recall: number;
  confidence: number;
  mapTokens: number;
  grepTokens: number;
  readFullTokens: number;
  readRangeTokens: number;
  without: number;
  with: number;
}

export interface BenchReport {
  evaluated: number;
  skipped: number;
  expand: boolean;
  budget: number;
  /** Mean share of the edited files the map contained */
  recall: number;
  /** Share of commits where the map contained at least one edited file */
  hitRate: number;
  /** Same, only over commits the hook would act on (confidence >= threshold) */
  confident: { threshold: number; share: number; recall: number; hitRate: number }[];
  tokens: { without: number; with: number; saved: number; map: number; grep: number; readFull: number; readRanges: number };
  commits: BenchCommit[];
}

export const DEFAULT_BENCH_COMMITS = 50;
const DEFAULT_GREP_CAP = 100;

export async function benchPilot(
  engine: IContextEngine,
  projectPath: string,
  options: BenchOptions = {}
): Promise<BenchReport> {
  const n = options.commits ?? DEFAULT_BENCH_COMMITS;
  const budget = options.budget ?? 1500;
  const expand = options.expand ?? false;
  const grepCap = options.grepCap ?? DEFAULT_GREP_CAP;

  const given = options.tasks ? Object.entries(options.tasks) : null;
  const taskFor = (sha: string) => given?.find(([prefix]) => sha.startsWith(prefix))?.[1];
  const depth = given ? Math.max(n * 3, 2000) : n * 3;
  const log = await runGit(projectPath, ["log", "--no-merges", `-n${depth}`, "--format=%H%x00%s"]);
  const subjects = new Map(
    log.stdout
      .split("\n")
      .filter(Boolean)
      .map((l) => l.split("\0") as [string, string])
  );
  const commits = (await readGitLog(projectPath, { maxCommits: depth })).filter(
    (c) => subjects.has(c.sha) && (!given || taskFor(c.sha) !== undefined)
  );

  const indexed = new Set(engine.indexedFiles({ projectPath }));
  const source = new Map<string, string>();
  const read = (path: string) => {
    if (!source.has(path)) {
      try {
        source.set(path, readFileSync(join(projectPath, path), "utf8"));
      } catch {
        source.set(path, "");
      }
    }
    return source.get(path)!;
  };
  const files = [...indexed];

  const results: BenchCommit[] = [];
  let skipped = 0;
  for (const c of commits) {
    if (results.length >= n) break;
    const task = taskFor(c.sha) ?? subjects.get(c.sha)!.replace(/^\w+(\([^)]*\))?!?:\s*/, ""); // drop "feat(x):"
    const targets = [
      ...new Set(
        c.files
          .filter((f) => f.status === "M" || f.status === "R")
          .map((f) => f.path)
          .filter((p) => !defaultIgnore(p) && indexed.has(p) && existsSync(join(projectPath, p)))
      ),
    ];
    if (targets.length === 0 || c.files.length > DEFAULT_MAX_FILES_PER_COMMIT || terms(task).length < 2) {
      skipped++;
      continue;
    }

    const map = engine.pilot({ projectPath, task, budget, expand });
    const inMap = new Map(map.files.map((f) => [f.path, f]));
    const found = targets.filter((t) => inMap.has(t));
    const grepTokens = grepCost(task, files, read, grepCap);
    const full = (p: string) => estimateTokens(read(p));
    const readFullTokens = targets.reduce((a, t) => a + full(t), 0);
    const readRangeTokens = targets.reduce((a, t) => {
      const f = inMap.get(t);
      if (!f) return a + full(t);
      const ranges = engine.outline({ projectPath, file: t }).symbols.filter((s) => f.matched.includes(s.name));
      return a + (ranges.length ? rangeTokens(read(t), ranges) : full(t));
    }, 0);
    const missedShare = (targets.length - found.length) / targets.length;
    const without = grepTokens + readFullTokens;
    const withPilot = map.tokens + readRangeTokens + Math.round(grepTokens * missedShare);

    results.push({
      sha: c.sha.slice(0, 8),
      task,
      targets,
      found,
      recall: found.length / targets.length,
      confidence: map.confidence,
      mapTokens: map.tokens,
      grepTokens,
      readFullTokens,
      readRangeTokens,
      without,
      with: withPilot,
    });
  }

  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const sum = (f: (c: BenchCommit) => number) => results.reduce((a, c) => a + f(c), 0);
  const without = sum((c) => c.without);
  const withPilot = sum((c) => c.with);
  return {
    evaluated: results.length,
    skipped,
    expand,
    budget,
    recall: mean(results.map((c) => c.recall)),
    hitRate: mean(results.map((c) => (c.found.length ? 1 : 0))),
    confident: [0.3, 0.5, 0.7].map((threshold) => {
      const sel = results.filter((c) => c.confidence >= threshold);
      return {
        threshold,
        share: results.length ? sel.length / results.length : 0,
        recall: mean(sel.map((c) => c.recall)),
        hitRate: mean(sel.map((c) => (c.found.length ? 1 : 0))),
      };
    }),
    tokens: {
      without,
      with: withPilot,
      saved: without ? 1 - withPilot / without : 0,
      map: sum((c) => c.mapTokens),
      grep: sum((c) => c.grepTokens),
      readFull: sum((c) => c.readFullTokens),
      readRanges: sum((c) => c.readRangeTokens),
    },
    commits: results,
  };
}

/** Tokens of `grep -rni <term>` output (path:line:text) for each term of the task, capped per term. */
function grepCost(task: string, files: string[], read: (p: string) => string, cap: number): number {
  let tokens = 0;
  for (const t of new Set(terms(task))) {
    let lines = 0;
    for (const f of files) {
      const text = read(f);
      if (!text.toLowerCase().includes(t)) continue;
      const rows = text.split(/\r?\n/);
      for (let i = 0; i < rows.length && lines < cap; i++) {
        if (rows[i].toLowerCase().includes(t)) {
          tokens += estimateTokens(`${f}:${i + 1}:${rows[i].trim().slice(0, 200)}`);
          lines++;
        }
      }
      if (lines >= cap) break;
    }
  }
  return tokens;
}

function rangeTokens(text: string, ranges: OutlineSymbol[]): number {
  const rows = text.split(/\r?\n/);
  const keep = new Set<number>();
  for (const r of ranges) for (let i = r.startLine; i <= r.endLine; i++) keep.add(i);
  return estimateTokens([...keep].map((i) => rows[i - 1] ?? "").join("\n"));
}

