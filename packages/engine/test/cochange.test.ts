import { describe, expect, it } from "vitest";
import { parseGitLog, type GitCommit } from "../src/history/git.js";
import { combineCoChanges, commitWeight, defaultIgnore, mineCommits, pairKey } from "../src/history/cochange.js";

const RS = "\x1e";
const FS = "\x1f";
const DAY = 24 * 3600;
const T0 = 1_700_000_000;

function commit(sha: string, timestamp: number, files: GitCommit["files"]): GitCommit {
  return { sha, timestamp, files };
}

const m = (path: string): GitCommit["files"][number] => ({ status: "M", path });

describe("parseGitLog", () => {
  it("parses commits, statuses and renames, tolerating CRLF", () => {
    const out =
      `${RS}aaa${FS}1700000000\r\n\r\nM\tsrc/a.ts\r\nA\tsrc/b.ts\r\n` +
      `${RS}bbb${FS}1699990000\n\nR087\tsrc/old.ts\tsrc/new.ts\nD\tsrc/gone.ts\n`;

    expect(parseGitLog(out)).toEqual([
      {
        sha: "aaa",
        timestamp: 1700000000,
        files: [
          { status: "M", path: "src/a.ts" },
          { status: "A", path: "src/b.ts" },
        ],
      },
      {
        sha: "bbb",
        timestamp: 1699990000,
        files: [
          { status: "R", oldPath: "src/old.ts", path: "src/new.ts" },
          { status: "D", path: "src/gone.ts" },
        ],
      },
    ]);
  });

  it("returns commits with no files for empty commits", () => {
    expect(parseGitLog(`${RS}ccc${FS}1\n`)).toEqual([{ sha: "ccc", timestamp: 1, files: [] }]);
  });
});

describe("mineCommits", () => {
  it("counts per-file commits and per-pair support", () => {
    const result = mineCommits([
      commit("3", T0 + 2, [m("a.ts"), m("b.ts")]),
      commit("2", T0 + 1, [m("a.ts"), m("b.ts"), m("c.ts")]),
      commit("1", T0, [m("a.ts")]),
    ]);

    expect(result.commitsProcessed).toBe(3);
    expect(result.files.get("a.ts")?.commits).toBe(3);
    expect(result.files.get("c.ts")?.commits).toBe(1);
    expect(result.pairs.get(pairKey("a.ts", "b.ts")[2])?.support).toBe(2);
    expect(result.pairs.get(pairKey("b.ts", "c.ts")[2])?.support).toBe(1);
    expect(result.pairs.get(pairKey("b.ts", "a.ts")[2])?.lastTs).toBe(T0 + 2);
  });

  it("skips bulk commits and ignored files", () => {
    const bulk = Array.from({ length: 31 }, (_, i) => m(`f${i}.ts`));
    const result = mineCommits([
      commit("2", T0, bulk),
      commit("1", T0, [m("a.ts"), m("package-lock.json"), m("dist/a.js")]),
    ]);

    expect(result.commitsSkipped).toBe(1);
    expect(result.commitsProcessed).toBe(1);
    expect([...result.files.keys()]).toEqual(["a.ts"]);
    expect(result.pairs.size).toBe(0);
  });

  it("attributes history before a rename to the current path", () => {
    const result = mineCommits([
      commit("3", T0 + 2, [m("src/new.ts"), m("src/b.ts")]),
      commit("2", T0 + 1, [{ status: "R", oldPath: "src/old.ts", path: "src/new.ts" }]),
      commit("1", T0, [m("src/old.ts"), m("src/b.ts")]),
    ]);

    expect(result.renames).toBe(1);
    expect(result.files.has("src/old.ts")).toBe(false);
    expect(result.files.get("src/new.ts")?.commits).toBe(3);
    expect(result.pairs.get(pairKey("src/new.ts", "src/b.ts")[2])?.support).toBe(2);
  });

  it("follows rename chains", () => {
    const result = mineCommits([
      commit("3", T0 + 2, [{ status: "R", oldPath: "b.ts", path: "c.ts" }]),
      commit("2", T0 + 1, [{ status: "R", oldPath: "a.ts", path: "b.ts" }]),
      commit("1", T0, [m("a.ts"), m("x.ts")]),
    ]);

    expect(result.pairs.get(pairKey("c.ts", "x.ts")[2])?.support).toBe(1);
  });

  it("ignores deleted files", () => {
    const result = mineCommits([commit("1", T0, [m("a.ts"), { status: "D", path: "b.ts" }])]);
    expect([...result.files.keys()]).toEqual(["a.ts"]);
  });
});

describe("commitWeight", () => {
  it("halves every 180 days", () => {
    expect(commitWeight(T0) / commitWeight(T0 - 180 * DAY)).toBeCloseTo(2);
  });
});

describe("defaultIgnore", () => {
  it("ignores lockfiles, build output and changelogs but not source", () => {
    expect(defaultIgnore("pnpm-lock.yaml")).toBe(true);
    expect(defaultIgnore("packages/x/dist/index.js")).toBe(true);
    expect(defaultIgnore("app.min.js")).toBe(true);
    expect(defaultIgnore("CHANGELOG.md")).toBe(true);
    expect(defaultIgnore("src/distance.ts")).toBe(false);
    expect(defaultIgnore("sql/carga_facturas.sql")).toBe(false);
  });
});

describe("combineCoChanges", () => {
  const stats = new Map([
    ["a.ts", { commits: 10, wcommits: 10 }],
    ["b.ts", { commits: 4, wcommits: 4 }],
  ]);

  it("filters by support and confidence and combines sources with noisy-OR", () => {
    const results = combineCoChanges(
      [
        { source: "a.ts", candidate: "x.ts", support: 5, wsupport: 5, lastTs: 3 },
        { source: "b.ts", candidate: "x.ts", support: 2, wsupport: 2, lastTs: 9 },
        { source: "a.ts", candidate: "y.ts", support: 8, wsupport: 8, lastTs: 1 },
        { source: "a.ts", candidate: "rare.ts", support: 1, wsupport: 1, lastTs: 1 },
        { source: "a.ts", candidate: "weak.ts", support: 2, wsupport: 0.5, lastTs: 1 },
      ],
      stats,
      { minSupport: 2, minConfidence: 0.1, shrinkage: 0 }
    );

    expect(results.map((r) => r.path)).toEqual(["y.ts", "x.ts"]);
    expect(results[0].score).toBeCloseTo(0.8);
    const x = results[1];
    // 1 - (1 - 5/10) * (1 - 2/4)
    expect(x.score).toBeCloseTo(0.75);
    expect(x.support).toBe(7);
    expect(x.lastChangedTogether).toBe(9);
    expect(x.sources.map((s) => s.file).sort()).toEqual(["a.ts", "b.ts"]);
  });
});

describe("combineCoChanges shrinkage", () => {
  it("damps confidence of files with little history", () => {
    const rows = [
      { source: "new.ts", candidate: "x.ts", support: 1, wsupport: 1, lastTs: 1 },
      { source: "old.ts", candidate: "y.ts", support: 9, wsupport: 9, lastTs: 1 },
    ];
    const stats = new Map([
      ["new.ts", { commits: 1, wcommits: 1 }],
      ["old.ts", { commits: 9, wcommits: 9 }],
    ]);
    const [y, x] = combineCoChanges(rows, stats, { minSupport: 1, minConfidence: 0, shrinkage: 1 });
    // "1 of 1" is weaker evidence than "9 of 9"
    expect(x.path).toBe("x.ts");
    expect(x.score).toBeCloseTo(0.5);
    expect(y.score).toBeCloseTo(0.9);
  });
});
