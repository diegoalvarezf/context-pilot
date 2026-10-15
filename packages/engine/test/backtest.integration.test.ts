import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { backtestRepo } from "../src/history/backtest.js";

let repo: string;
let clock = 1_700_000_000;

function git(...args: string[]): string {
  const date = `${clock} +0000`;
  return execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], {
    cwd: repo,
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    encoding: "utf8",
  });
}

function commitFiles(message: string, files: string[]): void {
  for (const f of files) {
    const abs = join(repo, f);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, `${message}\n${f}\n`);
  }
  git("add", "-A");
  git("commit", "-q", "-m", message);
  clock += 3600;
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "cp-backtest-"));
  git("init", "-q");
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("backtestRepo", () => {
  it("evaluates a real git history", async () => {
    for (let i = 0; i < 4; i++) commitFiles(`pair ${i}`, ["src/auth.ts", "src/session.ts"]);
    commitFiles("unrelated", ["docs/readme.md"]);
    commitFiles("pair again", ["src/auth.ts", "src/session.ts"]);

    const report = await backtestRepo(repo, { testCommits: 3 });
    expect(report.headSha).toBe(git("rev-parse", "HEAD").trim());
    expect(report.trainCommits).toBe(3);
    expect(report.evaluatedCommits).toBe(2);
    expect(report.metrics.find((m) => m.k === 5)!.hitRate).toBe(1);
  });

  it("leaves the analyzed repository untouched", async () => {
    commitFiles("c1", ["a.ts", "b.ts"]);
    commitFiles("c2", ["a.ts", "b.ts"]);
    commitFiles("c3", ["a.ts", "b.ts", "c.ts"]);
    git("checkout", "-q", "-b", "feature");
    commitFiles("c4", ["a.ts", "c.ts"]);
    // Uncommitted state that must survive as is
    writeFileSync(join(repo, "a.ts"), "local edit\n");
    writeFileSync(join(repo, "untracked.ts"), "new\n");

    const before = {
      head: git("rev-parse", "HEAD"),
      branch: git("rev-parse", "--abbrev-ref", "HEAD"),
      status: git("status", "--porcelain"),
      refs: git("for-each-ref"),
      stashes: git("stash", "list"),
    };

    await backtestRepo(repo, { testCommits: 2 });
    await backtestRepo(repo, { testCommits: 2, queryFiles: 2, walkForward: false });

    expect(git("rev-parse", "HEAD")).toBe(before.head);
    expect(git("rev-parse", "--abbrev-ref", "HEAD")).toBe(before.branch);
    expect(git("status", "--porcelain")).toBe(before.status);
    expect(git("for-each-ref")).toBe(before.refs);
    expect(git("stash", "list")).toBe(before.stashes);

    git("checkout", "-q", "--", "a.ts");
    rmSync(join(repo, "untracked.ts"));
    await backtestRepo(repo);
    expect(git("rev-parse", "HEAD")).toBe(before.head);
    expect(git("status", "--porcelain")).toBe("");
  });

  it("rejects non-repositories and empty repositories", async () => {
    await expect(backtestRepo(repo)).rejects.toThrow(/no commits/);
    const plain = mkdtempSync(join(tmpdir(), "cp-plain-"));
    try {
      await expect(backtestRepo(plain)).rejects.toThrow(/Not a git repository/);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});
