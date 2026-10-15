import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { ContextEngine } from "../src/engine.js";
import { parseNameStatus } from "../src/history/diff.js";

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

function write(files: string[], content: string): void {
  for (const f of files) {
    const abs = join(repo, f);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, `${content}\n${f}\n`);
  }
}

function commitFiles(message: string, files: string[]): void {
  write(files, message);
  git("add", "-A");
  git("commit", "-q", "-m", message);
  clock += 3600;
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "cp-check-"));
  dbDir = mkdtempSync(join(tmpdir(), "cp-db-"));
  git("init", "-q");
  engine = new ContextEngine(join(dbDir, "db.sqlite"));
});

afterEach(() => {
  engine.close();
  rmSync(repo, { recursive: true, force: true });
  rmSync(dbDir, { recursive: true, force: true });
});

describe("parseNameStatus", () => {
  it("parses statuses, renames and similarity scores", () => {
    expect(parseNameStatus("M\tsrc/a.ts\nR087\tsrc/old.ts\tsrc/new.ts\nD\tx.ts\n")).toEqual([
      { status: "M", path: "src/a.ts" },
      { status: "R", oldPath: "src/old.ts", path: "src/new.ts" },
      { status: "D", path: "x.ts" },
    ]);
  });
});

describe("checkChange", () => {
  beforeEach(() => {
    for (let i = 0; i < 3; i++) commitFiles(`pair ${i}`, ["src/auth.ts", "src/session.ts"]);
    commitFiles("lone", ["src/other.ts"]);
  });

  it("reports a usual partner missing from the working tree", async () => {
    await engine.mineHistory({ projectPath: repo });
    write(["src/auth.ts"], "edit");

    const res = await engine.checkChange({ projectPath: repo });
    expect(res.changed).toEqual([{ status: "M", path: "src/auth.ts" }]);
    expect(res.missing.map((r) => r.path)).toEqual(["src/session.ts"]);
  });

  it("stays quiet when the partner is part of the change", async () => {
    await engine.mineHistory({ projectPath: repo });
    write(["src/auth.ts", "src/session.ts"], "edit");
    expect((await engine.checkChange({ projectPath: repo })).missing).toEqual([]);
  });

  it("only looks at the index with staged, and includes untracked files otherwise", async () => {
    await engine.mineHistory({ projectPath: repo });
    write(["src/auth.ts"], "edit");
    write(["src/new.ts"], "new");
    git("add", "src/auth.ts");
    write(["src/other.ts"], "unstaged");

    const staged = await engine.checkChange({ projectPath: repo, staged: true });
    expect(staged.changed.map((c) => c.path)).toEqual(["src/auth.ts"]);

    const all = await engine.checkChange({ projectPath: repo });
    expect(all.changed.map((c) => c.path).sort()).toEqual(["src/auth.ts", "src/new.ts", "src/other.ts"]);
    expect(all.unknownFiles).toEqual(["src/new.ts"]);
  });

  it("checks a branch against its base", async () => {
    const base = git("rev-parse", "--abbrev-ref", "HEAD").trim();
    git("checkout", "-q", "-b", "feature");
    commitFiles("feature work", ["src/auth.ts"]);
    await engine.mineHistory({ projectPath: repo });

    const res = await engine.checkChange({ projectPath: repo, base });
    expect(res.changed.map((c) => c.path)).toEqual(["src/auth.ts"]);
    expect(res.missing.map((r) => r.path)).toEqual(["src/session.ts"]);
  });
});
