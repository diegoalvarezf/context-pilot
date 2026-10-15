import { describe, expect, it } from "vitest";
import type { GitCommit } from "../src/history/git.js";
import { combineCoChanges } from "../src/history/cochange.js";
import { backtestCoChanges } from "../src/history/backtest.js";

const T0 = 1_700_000_000;
type Change = GitCommit["files"][number];
const m = (path: string): Change => ({ status: "M", path });
const a = (path: string): Change => ({ status: "A", path });

/** Builds a newest-first history from commits listed oldest-first. */
function history(...commits: Change[][]): GitCommit[] {
  return commits.map((files, i) => ({ sha: `c${i}`, timestamp: T0 + i * 3600, files })).reverse();
}

const metric = (report: ReturnType<typeof backtestCoChanges>, k: number) => report.metrics.find((x) => x.k === k)!;

describe("backtestCoChanges", () => {
  it("predicts the rest of a commit from older history", () => {
    const commits = history(
      [m("a.ts"), m("b.ts")],
      [m("a.ts"), m("b.ts")],
      [m("a.ts"), m("b.ts")] // test
    );
    const report = backtestCoChanges(commits, { testCommits: 1, ks: [1, 5] });

    expect(report.trainCommits).toBe(2);
    expect(report.evaluatedCommits).toBe(1);
    expect(report.queries).toBe(2);
    expect(report.answered).toBe(2);
    expect(report.coverage).toBe(1);
    expect(metric(report, 1)).toEqual({ k: 1, precision: 1, recall: 1, hitRate: 1 });
  });

  it("never sees the test commit itself (no leakage)", () => {
    const commits = history(
      [m("a.ts"), m("x.ts")],
      [m("a.ts"), m("x.ts")],
      [m("a.ts"), m("b.ts")] // test: a+b never seen together before
    );
    const report = backtestCoChanges(commits, { testCommits: 1, minSupport: 1 });

    // a.ts predicts x.ts (wrong); b.ts has no history at all
    expect(report.queries).toBe(2);
    expect(report.answered).toBe(1);
    expect(metric(report, 5)).toEqual({ k: 5, precision: 0, recall: 0, hitRate: 0 });
  });

  it("learns from earlier test commits when walking forward", () => {
    const commits = history(
      [m("seed.ts")],
      [m("a.ts"), m("b.ts")], // test 1
      [m("a.ts"), m("b.ts")] // test 2
    );
    const walk = backtestCoChanges(commits, { testCommits: 2, minSupport: 1 });
    expect(walk.evaluatedCommits).toBe(2);
    // test 1 cannot be predicted, test 2 is predicted from test 1
    expect(metric(walk, 5).hitRate).toBeCloseTo(0.5);

    const fixed = backtestCoChanges(commits, { testCommits: 2, minSupport: 1, walkForward: false });
    expect(metric(fixed, 5).hitRate).toBe(0);
    expect(fixed.coverage).toBe(0);
  });

  it("excludes added files from queries and targets", () => {
    const commits = history(
      [m("a.ts"), m("b.ts")],
      [m("a.ts"), m("b.ts"), a("new.ts")] // test
    );
    const report = backtestCoChanges(commits, { testCommits: 1, minSupport: 1 });
    expect(report.queries).toBe(2);
    expect(metric(report, 5).recall).toBe(1);

    const onlyNew = backtestCoChanges(history([m("a.ts")], [m("a.ts"), a("new.ts")]), { testCommits: 1 });
    expect(onlyNew.evaluatedCommits).toBe(0);
    expect(onlyNew.skipped.tooFewFiles).toBe(1);
  });

  it("skips bulk commits and ignored files", () => {
    const big = Array.from({ length: 40 }, (_, i) => m(`f${i}.ts`));
    const report = backtestCoChanges(history([m("a.ts")], big, [m("a.ts"), m("pnpm-lock.yaml")]), {
      testCommits: 2,
    });
    expect(report.skipped).toEqual({ bulk: 1, tooFewFiles: 1 });
    expect(report.evaluatedCommits).toBe(0);
  });

  it("follows renames: history under the old name predicts the new one", () => {
    const commits = history(
      [m("old.ts"), m("peer.ts")],
      [m("old.ts"), m("peer.ts")],
      [{ status: "R", oldPath: "old.ts", path: "new.ts" }, m("peer.ts")], // test 1: query uses old.ts
      [m("new.ts"), m("peer.ts")] // test 2: history moved to new.ts
    );
    const report = backtestCoChanges(commits, { testCommits: 2, minSupport: 2 });
    expect(report.evaluatedCommits).toBe(2);
    expect(metric(report, 5).hitRate).toBe(1);
  });

  it("does not suggest files deleted before the test commit", () => {
    const commits = history(
      [m("a.ts"), m("gone.ts"), m("b.ts")],
      [m("a.ts"), m("gone.ts"), m("b.ts")],
      [{ status: "D", path: "gone.ts" }],
      [m("a.ts"), m("b.ts")] // test
    );
    const report = backtestCoChanges(commits, { testCommits: 1, ks: [1] });
    expect(metric(report, 1).precision).toBe(1);
  });

  it("queries with several files when queryFiles > 1", () => {
    const commits = history(
      [m("a.ts"), m("b.ts"), m("c.ts")],
      [m("a.ts"), m("b.ts"), m("c.ts")],
      [m("a.ts"), m("b.ts")], // test: only 2 files, needs 3 for a 2-file query
      [m("a.ts"), m("b.ts"), m("c.ts")] // test
    );
    const report = backtestCoChanges(commits, { testCommits: 2, queryFiles: 2 });
    expect(report.evaluatedCommits).toBe(1);
    expect(report.skipped.tooFewFiles).toBe(1);
    expect(report.queries).toBe(1);
    expect(metric(report, 5).recall).toBe(1);
  });

  it("caps the test set to the available history", () => {
    const report = backtestCoChanges(history([m("a.ts"), m("b.ts")]), { testCommits: 200 });
    expect(report.testCommits).toBe(1);
    expect(report.trainCommits).toBe(0);
  });
});

describe("combineCoChanges combination methods", () => {
  const stats = new Map([
    ["a.ts", { commits: 10, wcommits: 10 }],
    ["b.ts", { commits: 4, wcommits: 4 }],
  ]);
  const rows = [
    { source: "a.ts", candidate: "x.ts", support: 5, wsupport: 5, lastTs: 1 },
    { source: "b.ts", candidate: "x.ts", support: 2, wsupport: 2, lastTs: 1 },
    { source: "a.ts", candidate: "y.ts", support: 6, wsupport: 6, lastTs: 1 },
  ];
  const score = (combine: "noisy-or" | "max" | "mean", sourceCount?: number) =>
    Object.fromEntries(
      combineCoChanges(rows, stats, { minSupport: 1, minConfidence: 0, combine, sourceCount }).map((r) => [r.path.replace(".ts", ""), r.score])
    );

  it("supports noisy-OR, max and mean", () => {
    expect(score("noisy-or").x).toBeCloseTo(0.75);
    expect(score("max").x).toBeCloseTo(0.5);
    expect(score("max").y).toBeCloseTo(0.6);
    expect(score("mean").x).toBeCloseTo(0.5);
    // y.ts only links to a.ts, so b.ts counts as 0 in the mean
    expect(score("mean").y).toBeCloseTo(0.3);
    expect(score("mean", 3).x).toBeCloseTo(1 / 3);
  });
});
