import { describe, expect, it } from "vitest";
import {
  contextPilotPlugin,
  globalPackageName,
  hookCommand,
  hookRunCheck,
  indexCheck,
  isDevLink,
  mcpCheck,
  pinnedVersion,
} from "../src/doctor.js";

describe("doctor", () => {
  it("finds the plugin in Claude Code's registry", () => {
    const registry = { version: 2, plugins: { "context-pilot@context-pilot": [{ scope: "user", installPath: "/p/0.7.0", version: "0.7.0" }], "x@y": [] } };
    expect(contextPilotPlugin(registry)).toEqual({ version: "0.7.0", installPath: "/p/0.7.0", scope: "user" });
    expect(contextPilotPlugin({ plugins: {} })).toBeNull();
    expect(contextPilotPlugin(null)).toBeNull();
  });

  it("reads our hook command for an event", () => {
    const hooks = { hooks: { Stop: [{ hooks: [{ type: "command", command: "lint" }, { type: "command", command: "npx -y context-pilot@0.7.0 on stop --hook" }] }] } };
    expect(hookCommand(hooks, "Stop")).toBe("npx -y context-pilot@0.7.0 on stop --hook");
    expect(hookCommand(hooks, "UserPromptSubmit")).toBeNull();
    expect(pinnedVersion("npx -y context-pilot@0.7.0 on stop")).toBe("0.7.0");
    expect(pinnedVersion("/usr/bin/node /x/cli.js on stop")).toBeNull();
  });

  it("tells a source checkout link from an npm install", () => {
    expect(isDevLink("/Users/d/repos/context-pilot/packages/cli/dist/index.js")).toBe(true);
    expect(isDevLink("/opt/homebrew/lib/node_modules/context-pilot/dist/index.js")).toBe(false);
    expect(globalPackageName("../lib/node_modules/@context-pilot/cli/dist/index.js")).toBe("@context-pilot/cli");
    expect(globalPackageName("../lib/node_modules/context-pilot/dist/index.js")).toBe("context-pilot");
  });

  it("judges the MCP handshake", () => {
    const ok = '{"jsonrpc":"2.0","id":1,"result":{}}\n{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"pilot"},{"name":"outline"}]}}\n';
    expect(mcpCheck(ok, "", 900, false)).toMatchObject({ status: "ok", detail: "2 tools: pilot, outline" });
    expect(mcpCheck("", "Not initialized. Run context-pilot init first.\n", 2000, false)).toMatchObject({
      status: "fail",
      detail: "Not initialized. Run context-pilot init first.",
    });
    expect(mcpCheck("", "", 30000, true)).toMatchObject({ status: "fail", detail: "no answer in 30s" });
  });

  it("judges the hook run and the index", () => {
    expect(hookRunCheck("prompt", 0, 800, "", false).status).toBe("ok");
    expect(hookRunCheck("prompt", 0, 9000, "", false).status).toBe("warn");
    expect(hookRunCheck("prompt", 1, 100, "Error: x\n", false)).toMatchObject({ status: "fail", detail: "Error: x" });
    expect(indexCheck({ indexed: false }).status).toBe("warn");
    const now = Date.parse("2026-10-29T12:00:00Z");
    expect(indexCheck({ indexed: true, files: 40, indexedAt: now - 5 * 60e3, history: { commitsProcessed: 120, minedAt: now } }, now)).toMatchObject({
      status: "ok",
      title: "Project indexed: 40 files, 120 commits of history",
      detail: "indexed 5 min ago",
    });
  });
});
