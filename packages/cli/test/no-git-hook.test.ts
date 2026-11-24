import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawnSync } from "child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { ContextEngine } from "context-pilot-engine";
import { readTrace } from "../src/trace.js";

const cli = join(__dirname, "..", "dist", "index.js");
const temp = (name: string) => {
  const dir = mkdtempSync(join(tmpdir(), name));
  return realpathSync.native ? realpathSync.native(dir) : realpathSync(dir);
};

let home: string;
let project: string;

/** Runs a hook with its own home, so the database it reads is this test's and not the user's. */
function hook(event: string, input: object) {
  const r = spawnSync(process.execPath, [cli, "on", event, "--hook", "--agent", "claude"], {
    input: JSON.stringify(input),
    env: { ...process.env, CONTEXT_PILOT_HOME: join(home, ".context-pilot"), USERPROFILE: home, HOME: home },
    encoding: "utf8",
  });
  expect(r.status).toBe(0);
  return { stdout: r.stdout, trace: readTrace(join(home, ".context-pilot", "trace.jsonl")).pop()! };
}

const search = (cwd: string) => hook("search", { session_id: `nogit-${Date.now()}-${Math.random()}`, cwd, tool_name: "Grep", tool_input: { pattern: "fetchWithRetry" } });

describe("hooks in a folder without git", () => {
  beforeAll(() => {
    home = temp("cp-home-");
    project = temp("cp-nogit-");
    mkdirSync(join(project, "src"), { recursive: true });
    writeFileSync(join(project, "src", "retry.ts"), "export function fetchWithRetry(url: string) {\n  return url;\n}\n");
  });

  it("stay out of a folder that was never indexed", () => {
    const { stdout, trace } = search(project);
    expect(stdout).toBe("");
    expect(trace).toMatchObject({ event: "search", result: "skipped", reason: "not a git repository or an indexed project" });
  });

  it("answer from the index once the folder is indexed, from any folder inside it", async () => {
    mkdirSync(join(home, ".context-pilot"), { recursive: true });
    const engine = new ContextEngine(join(home, ".context-pilot", "db.sqlite"));
    try {
      const indexed = await engine.index({ projectPath: project });
      expect(indexed.success).toBe(true);
      expect(engine.projectRootFor(join(project, "src"))).not.toBeNull();
      expect(engine.projectRootFor(temp("cp-other-"))).toBeNull();
    } finally {
      engine.close();
    }

    const { stdout, trace } = search(join(project, "src"));
    expect(stdout).toContain("fetchWithRetry");
    expect(stdout).toContain("src/retry.ts");
    expect(trace).toMatchObject({ event: "search", result: "said" });
    expect(trace.project).not.toBeNull();
  });

  it("have nothing to check at stop: uncommitted changes need git", () => {
    const { stdout, trace } = hook("stop", { session_id: "nogit-stop", cwd: project });
    expect(stdout).toBe("");
    expect(trace).toMatchObject({ event: "stop", result: "silent", reason: "not a git repository" });
  });
});
