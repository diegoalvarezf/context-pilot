import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawnSync } from "child_process";
import { ContextEngine } from "context-pilot-engine";
import { handleHandoff } from "../../mcp-server/src/tools/handoff.js";
import { handlePilot } from "../../mcp-server/src/tools/pilot.js";

let repo: string;
let dbDir: string;
let engine: ContextEngine;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "cp-cli-handoff-repo-"));
  dbDir = mkdtempSync(join(tmpdir(), "cp-cli-handoff-db-"));
  spawnSync("git", ["init", "-q"], { cwd: repo });
  writeFileSync(join(repo, "index.ts"), "export const hello = 'world';\n");
  engine = new ContextEngine(join(dbDir, "db.sqlite"));
});

afterEach(() => {
  engine.close();
  rmSync(repo, { recursive: true, force: true });
  rmSync(dbDir, { recursive: true, force: true });
});

describe("MCP handoff tool", () => {
  it("records a handoff via handleHandoff set", async () => {
    const res = await handleHandoff(
      {
        summary: "Worked on auth tokens",
        activeFiles: ["index.ts"],
        nextSteps: "Write tests",
        agent: "claude",
      },
      engine,
      repo
    );

    expect(res).toContain("Session handoff recorded for");
    expect(res).toContain("Summary: Worked on auth tokens");
    expect(res).toContain("Active Files: index.ts");
    expect(res).toContain("Next Steps: Write tests");
    expect(res).toContain("Agent: claude");
  });

  it("reads back a recorded handoff via handleHandoff get", async () => {
    engine.setHandoff({
      projectPath: repo,
      summary: "Refactoring database layer",
      activeFiles: ["index.ts"],
      nextSteps: "Migrate schema",
      agent: "antigravity",
    });

    const res = await handleHandoff({ action: "get" }, engine, repo);
    expect(res).toContain("Session handoff for");
    expect(res).toContain("Summary: Refactoring database layer");
    expect(res).toContain("Active Files: index.ts");
    expect(res).toContain("Next Steps: Migrate schema");
    expect(res).toContain("Agent: antigravity");
  });

  it("returns message when no handoff is recorded", async () => {
    const res = await handleHandoff({ action: "get" }, engine, repo);
    expect(res).toContain("No session handoff recorded for");
  });

  it("injects handoff into handlePilot automatically", async () => {
    await engine.init();
    await engine.index({ projectPath: repo });

    engine.setHandoff({
      projectPath: repo,
      summary: "Adding greeting endpoint",
      activeFiles: ["index.ts"],
      nextSteps: "Add tests",
      agent: "antigravity",
    });

    const pilotRes = await handlePilot(
      { task: "find the greeting export" },
      engine,
      repo
    );

    expect(pilotRes).toContain("[Session Handoff (");
    expect(pilotRes).toContain("Adding greeting endpoint");
    expect(pilotRes).toContain("Files: index.ts");
    expect(pilotRes).toContain("Next: Add tests");
  });
});

describe("CLI handoff command", () => {
  it("runs context-pilot handoff via CLI", () => {
    const cli = join(__dirname, "..", "dist", "index.js");
    const setRun = spawnSync(
      process.execPath,
      [cli, "handoff", "Testing CLI handoff", "-p", repo, "-f", "index.ts", "-n", "Done", "-a", "cli-test"],
      { encoding: "utf8", env: { ...process.env, CONTEXT_PILOT_HOME: dbDir } }
    );

    expect(setRun.status).toBe(0);
    expect(setRun.stdout).toContain("Session handoff recorded for");

    const getRun = spawnSync(
      process.execPath,
      [cli, "handoff", "-p", repo, "--json"],
      { encoding: "utf8", env: { ...process.env, CONTEXT_PILOT_HOME: dbDir } }
    );

    expect(getRun.status).toBe(0);
    const parsed = JSON.parse(getRun.stdout);
    expect(parsed.handoff.summary).toBe("Testing CLI handoff");
    expect(parsed.handoff.activeFiles).toEqual(["index.ts"]);
    expect(parsed.handoff.nextSteps).toBe("Done");
    expect(parsed.handoff.agent).toBe("cli-test");

    const clearRun = spawnSync(
      process.execPath,
      [cli, "handoff", "-p", repo, "--clear", "--json"],
      { encoding: "utf8", env: { ...process.env, CONTEXT_PILOT_HOME: dbDir } }
    );

    expect(clearRun.status).toBe(0);
    expect(JSON.parse(clearRun.stdout).cleared).toBe(true);
  });
});
