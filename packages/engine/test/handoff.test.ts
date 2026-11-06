import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { ContextEngine } from "../src/engine.js";
import { formatHandoffHeader, isRecentHandoff } from "../src/handoff.js";

let repo: string;
let dbDir: string;
let engine: ContextEngine;

function git(...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], {
    cwd: repo,
    encoding: "utf8",
  });
}

function write(file: string, content: string): void {
  const abs = join(repo, file);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "cp-handoff-repo-"));
  dbDir = mkdtempSync(join(tmpdir(), "cp-handoff-db-"));
  git("init", "-q");
  engine = new ContextEngine(join(dbDir, "db.sqlite"));
});

afterEach(() => {
  engine.close();
  rmSync(repo, { recursive: true, force: true });
  rmSync(dbDir, { recursive: true, force: true });
});

describe("Handoff helpers", () => {
  it("formats handoff header matching specification", () => {
    const header = formatHandoffHeader({
      summary: "Refactored auth module",
      activeFiles: ["src/auth.ts", "src/session.ts"],
      nextSteps: "Add unit tests",
      agent: "antigravity",
      updatedAt: "2026-11-06T10:00:00.000Z",
    });

    expect(header).toBe(
      "[Session Handoff (2026-11-06T10:00:00.000Z)]: Refactored auth module | Files: src/auth.ts, src/session.ts | Next: Add unit tests"
    );
  });

  it("formats handoff header without optional fields", () => {
    const header = formatHandoffHeader({
      summary: "Investigating bug",
      activeFiles: [],
      updatedAt: "2026-11-06T10:00:00.000Z",
    });

    expect(header).toBe("[Session Handoff (2026-11-06T10:00:00.000Z)]: Investigating bug");
  });

  it("checks recent handoff within 24h", () => {
    const now = new Date().toISOString();
    const old = new Date(Date.now() - 25 * 3600 * 1000).toISOString();

    expect(isRecentHandoff({ summary: "test", activeFiles: [], updatedAt: now })).toBe(true);
    expect(isRecentHandoff({ summary: "test", activeFiles: [], updatedAt: old })).toBe(false);
  });
});

describe("ContextEngine Handoff storage and retrieval", () => {
  it("returns null when no handoff is stored", async () => {
    const res = await engine.getHandoff({ projectPath: repo });
    expect(res.handoff).toBeNull();
    expect(engine.getHandoffRecord({ projectPath: repo })).toBeNull();
  });

  it("stores and retrieves handoff with normalized paths", async () => {
    const saved = engine.setHandoff({
      projectPath: repo,
      summary: "Implemented handoff feature",
      activeFiles: [join(repo, "src", "index.ts"), "package.json"],
      nextSteps: "Run tests and build",
      agent: "antigravity",
    });

    expect(saved.summary).toBe("Implemented handoff feature");
    expect(saved.activeFiles).toEqual(["src/index.ts", "package.json"]);
    expect(saved.nextSteps).toBe("Run tests and build");
    expect(saved.agent).toBe("antigravity");

    const record = engine.getHandoffRecord({ projectPath: repo });
    expect(record).not.toBeNull();
    expect(record?.summary).toBe("Implemented handoff feature");
    expect(record?.activeFiles).toEqual(["src/index.ts", "package.json"]);
    expect(record?.agent).toBe("antigravity");
  });

  it("updates existing handoff on subsequent set", async () => {
    engine.setHandoff({
      projectPath: repo,
      summary: "Initial work",
      activeFiles: ["file1.ts"],
    });

    engine.setHandoff({
      projectPath: repo,
      summary: "Second stage",
      activeFiles: ["file2.ts"],
      nextSteps: "Deploy",
      agent: "claude",
    });

    const record = engine.getHandoffRecord({ projectPath: repo });
    expect(record?.summary).toBe("Second stage");
    expect(record?.activeFiles).toEqual(["file2.ts"]);
    expect(record?.nextSteps).toBe("Deploy");
    expect(record?.agent).toBe("claude");
  });

  it("retrieves uncommitted git status for active files", async () => {
    write("src/auth.ts", "export const a = 1;\n");
    git("add", "src/auth.ts");
    git("commit", "-m", "init");

    // Modify active file without committing
    write("src/auth.ts", "export const a = 2;\n");

    engine.setHandoff({
      projectPath: repo,
      summary: "Modified auth",
      activeFiles: ["src/auth.ts"],
    });

    const res = await engine.getHandoff({ projectPath: repo });
    expect(res.handoff).not.toBeNull();
    expect(res.gitStatus).toBeDefined();
    expect(res.gitStatus).toContain("src/auth.ts");
  });

  it("clears handoff", async () => {
    engine.setHandoff({
      projectPath: repo,
      summary: "Temporary task",
      activeFiles: ["temp.ts"],
    });

    expect(engine.getHandoffRecord({ projectPath: repo })).not.toBeNull();
    engine.clearHandoff({ projectPath: repo });
    expect(engine.getHandoffRecord({ projectPath: repo })).toBeNull();
  });
});
