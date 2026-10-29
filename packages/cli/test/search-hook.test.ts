import { existsSync, mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawnSync } from "child_process";
import { describe, expect, it } from "vitest";
import { addAgentHooks } from "../src/agent-config.js";
import { parseHookInput, searchedName, shellSearchPattern } from "../src/agents.js";

const cli = join(__dirname, "..", "dist", "index.js");
const run = (input: object, home: string) =>
  spawnSync(process.execPath, [cli, "on", "search", "--hook", "--agent", "claude"], {
    input: JSON.stringify(input),
    env: { ...process.env, CONTEXT_PILOT_HOME: home },
    encoding: "utf8",
  });

describe("search hook", () => {
  it("only reads shell commands that start with a search", () => {
    expect(shellSearchPattern("rg -n retryDelay src")).toBe("retryDelay");
    expect(shellSearchPattern("git grep -e fetchWithRetry")).toBe("fetchWithRetry");
    expect(shellSearchPattern("cd src && rg retryDelay")).toBeNull();
    expect(shellSearchPattern("cat a.ts | grep retryDelay")).toBeNull();
    expect(shellSearchPattern("npm test")).toBeNull();
  });

  it("is installed on Grep only for Claude Code", () => {
    const config = addAgentHooks({}, "claude", (e) => `cp on ${e} --hook --agent claude`, ["search"]);
    expect((config.hooks as Record<string, { matcher?: string }[]>).PreToolUse[0].matcher).toBe("Grep");
  });

  it("leaves at once, writing no trace, when the tool call isn't a symbol search", () => {
    const home = mkdtempSync(join(tmpdir(), "cp-home-"));
    for (const input of [
      { session_id: "s", cwd: tmpdir(), tool_name: "Bash", tool_input: { command: "git status --short" } },
      { session_id: "s", cwd: tmpdir(), tool_name: "Grep", tool_input: { pattern: "foo.*bar|baz" } },
    ]) {
      const r = run(input, home);
      expect(r.status).toBe(0);
      expect(r.stdout).toBe("");
    }
    expect(existsSync(join(home, "trace.jsonl"))).toBe(false);
  });

  it("still traces real symbol searches", () => {
    const home = mkdtempSync(join(tmpdir(), "cp-home-"));
    const input = { session_id: "s", cwd: mkdtempSync(join(tmpdir(), "cp-norepo-")), tool_name: "Grep", tool_input: { pattern: "fetchWithRetry" } };
    expect(searchedName(parseHookInput(JSON.stringify(input)))).toBe("fetchWithRetry");
    expect(run(input, home).status).toBe(0);
    expect(JSON.parse(readFileSync(join(home, "trace.jsonl"), "utf8"))).toMatchObject({ event: "search", result: "skipped", reason: "not a git repository" });
  });
});
