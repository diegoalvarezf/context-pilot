import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { ContextEngine } from "../src/engine.js";

let repo: string;
let dbDir: string;
let engine: ContextEngine;
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
  repo = mkdtempSync(join(tmpdir(), "cp-repo-"));
  dbDir = mkdtempSync(join(tmpdir(), "cp-db-"));
  git("init", "-q");
  engine = new ContextEngine(join(dbDir, "db.sqlite"));
});

afterEach(() => {
  engine.close();
  rmSync(repo, { recursive: true, force: true });
  rmSync(dbDir, { recursive: true, force: true });
});

describe("git history mining", () => {
  it("reports repos without commits", async () => {
    expect((await engine.mineHistory({ projectPath: repo })).status).toBe("no-commits");
  });

  it("mines co-changes, then updates incrementally", async () => {
    commitFiles("c1", ["src/auth.ts", "src/middleware.ts"]);
    commitFiles("c2", ["src/auth.ts", "src/middleware.ts", "test/auth.test.ts"]);
    commitFiles("c3", ["src/auth.ts", "test/auth.test.ts"]);
    commitFiles("c4", ["src/other.ts"]);

    const first = await engine.mineHistory({ projectPath: repo });
    expect(first.status).toBe("full");
    expect(first.commitsProcessed).toBe(4);

    const res = engine.coChanges({ projectPath: repo, files: ["src/auth.ts"] });
    expect(res.unknownFiles).toEqual([]);
    expect(res.results.map((r) => r.path).sort()).toEqual(["src/middleware.ts", "test/auth.test.ts"]);
    expect(res.results[0].sources[0].support).toBe(2);

    expect((await engine.mineHistory({ projectPath: repo })).status).toBe("up-to-date");

    commitFiles("c5", ["src/other.ts", "src/middleware.ts"]);
    commitFiles("c6", ["src/other.ts", "src/middleware.ts"]);
    const second = await engine.mineHistory({ projectPath: repo });
    expect(second.status).toBe("incremental");
    expect(second.commitsProcessed).toBe(6);

    const other = engine.coChanges({ projectPath: repo, files: [join(repo, "src", "other.ts")] });
    expect(other.results.map((r) => r.path)).toEqual(["src/middleware.ts"]);
  });

  it("re-mines fully after a rename and follows the new path", async () => {
    commitFiles("c1", ["src/old.ts", "src/peer.ts"]);
    commitFiles("c2", ["src/old.ts", "src/peer.ts"]);
    await engine.mineHistory({ projectPath: repo });

    git("mv", "src/old.ts", "src/new.ts");
    git("commit", "-q", "-m", "rename");
    clock += 3600;

    const result = await engine.mineHistory({ projectPath: repo });
    expect(result.status).toBe("full");

    const res = engine.coChanges({ projectPath: repo, files: ["src/new.ts"] });
    expect(res.results.map((r) => r.path)).toEqual(["src/peer.ts"]);
    expect(res.results[0].sources[0].support).toBe(2);
  });

  it("does not suggest files that no longer exist", async () => {
    commitFiles("c1", ["a.ts", "b.ts"]);
    commitFiles("c2", ["a.ts", "b.ts"]);
    git("rm", "-q", "b.ts");
    git("commit", "-q", "-m", "drop b");
    await engine.mineHistory({ projectPath: repo });

    expect(engine.coChanges({ projectPath: repo, files: ["a.ts"] }).results).toEqual([]);
  });

  it("re-mines fully when history was rewritten", async () => {
    commitFiles("c1", ["a.ts", "b.ts"]);
    commitFiles("c2", ["a.ts", "b.ts"]);
    await engine.mineHistory({ projectPath: repo });

    git("reset", "-q", "--hard", "HEAD~1");
    commitFiles("c2b", ["a.ts", "c.ts"]);
    const result = await engine.mineHistory({ projectPath: repo });

    expect(result.status).toBe("full");
    expect(result.commitsProcessed).toBe(2);
  });
});
