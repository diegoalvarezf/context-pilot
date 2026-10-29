import { describe, expect, it } from "vitest";
import { editedFiles, formatReply, parseHookInput, searchedName } from "../src/agents.js";
import {
  addAgentHooks,
  addMcpServer,
  agentsMdBlock,
  codexMcpBlock,
  geminiReadsAgentsMd,
  hasAgentHooks,
  removeAgentHooks,
  removeMcpServer,
} from "../src/agent-config.js";

const cmd = (e: string) => `/usr/bin/node /cli/index.js on ${e} --hook --agent x -p "/repo"`;

describe("parseHookInput", () => {
  it("reads Claude / Codex payloads", () => {
    const i = parseHookInput(
      JSON.stringify({ session_id: "s1", cwd: "/repo", hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: "/repo/a.ts" } })
    );
    expect(i).toMatchObject({ sessionId: "s1", cwd: "/repo", toolName: "Edit", stopActive: false });
    expect(editedFiles(i)).toEqual(["/repo/a.ts"]);
  });

  it("reads Copilot's camelCase fields and JSON-string tool args", () => {
    const i = parseHookInput(JSON.stringify({ sessionId: "c", toolName: "edit", toolArgs: '{"path":"src/b.ts"}' }));
    expect(i.sessionId).toBe("c");
    expect(editedFiles(i)).toEqual(["src/b.ts"]);
  });

  it("reads Cursor's loop count as an active stop", () => {
    expect(parseHookInput(JSON.stringify({ conversation_id: "k", status: "completed", loop_count: 1 })).stopActive).toBe(true);
    expect(parseHookInput(JSON.stringify({ stop_hook_active: true })).stopActive).toBe(true);
    expect(parseHookInput("").sessionId).toBe("default");
  });

  it("finds the files of a Codex apply_patch", () => {
    const patch = "*** Begin Patch\n*** Update File: src/a.ts\n@@\n-x\n+y\n*** Add File: src/new.ts\n+z\n*** End Patch";
    expect(editedFiles(parseHookInput(JSON.stringify({ tool_name: "apply_patch", tool_input: { input: patch } })))).toEqual([
      "src/a.ts",
      "src/new.ts",
    ]);
  });
});

describe("searchedName", () => {
  const grep = (tool: string, input: Record<string, unknown>) =>
    searchedName(parseHookInput(JSON.stringify({ tool_name: tool, tool_input: input })));

  it("takes identifiers from the Grep tool and from grep/rg in a shell", () => {
    expect(grep("Grep", { pattern: "fetchWithRetry" })).toBe("fetchWithRetry");
    expect(grep("Grep", { pattern: "\\bparseGitLog\\b" })).toBe("parseGitLog");
    expect(grep("Bash", { command: 'rg -n "computeImpact" src' })).toBe("computeImpact");
    expect(grep("Bash", { command: "grep -rn --include=*.ts isTestFile ." })).toBe("isTestFile");
  });

  it("ignores searches that aren't for a name", () => {
    expect(grep("Grep", { pattern: "TODO|FIXME" })).toBeNull();
    expect(grep("Grep", { pattern: "a" })).toBeNull();
    expect(grep("Bash", { command: "ls -la" })).toBeNull();
  });
});

describe("formatReply", () => {
  it("uses each agent's way to add context", () => {
    expect(JSON.parse(formatReply("claude", "prompt", "map").stdout!)).toEqual({
      hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: "map" },
    });
    expect(JSON.parse(formatReply("gemini", "edit", "x").stdout!).hookSpecificOutput.hookEventName).toBe("AfterTool");
    expect(JSON.parse(formatReply("cursor", "edit", "x").stdout!)).toEqual({ additional_context: "x" });
    expect(JSON.parse(formatReply("copilot", "edit", "x").stdout!)).toEqual({ additionalContext: "x" });
  });

  it("asks the agent to keep going on stop", () => {
    expect(JSON.parse(formatReply("claude", "stop", "r").stdout!)).toEqual({ decision: "block", reason: "r" });
    expect(JSON.parse(formatReply("gemini", "stop", "r").stdout!)).toEqual({ decision: "deny", reason: "r" });
    expect(JSON.parse(formatReply("cursor", "stop", "r").stdout!)).toEqual({ followup_message: "r" });
  });
});

describe("agent hook configs", () => {
  const theirs = { matcher: "Bash", hooks: [{ type: "command", command: "my-linter" }] };

  it("adds Claude hooks for every event, keeps other hooks, and is idempotent", () => {
    const start = { model: "x", hooks: { PreToolUse: [theirs] } };
    const once = addAgentHooks(start, "claude", cmd);
    const twice = addAgentHooks(once, "claude", cmd);
    expect(twice).toEqual(once);
    const hooks = once.hooks as Record<string, unknown[]>;
    expect(Object.keys(hooks).sort()).toEqual(["PostToolUse", "PreToolUse", "Stop", "UserPromptSubmit"]);
    expect(hooks.PreToolUse).toHaveLength(2);
    expect(hooks.PreToolUse[0]).toEqual(theirs);
    expect(hasAgentHooks(once)).toBe(true);
    expect(removeAgentHooks(once)).toEqual(start);
  });

  it("replaces hooks installed by older versions (--claude-hook)", () => {
    const old = { hooks: { Stop: [{ hooks: [{ type: "command", command: "node cli.js check --claude-hook -p x" }] }] } };
    const next = addAgentHooks(old, "claude", cmd, ["stop"]);
    expect((next.hooks as Record<string, unknown[]>).Stop).toHaveLength(1);
    expect(JSON.stringify(next)).not.toContain("--claude-hook");
  });

  it("writes flat entries for Cursor and Copilot, only for the events they support", () => {
    const cursor = addAgentHooks({}, "cursor", cmd);
    expect(cursor).toEqual({
      version: 1,
      hooks: { postToolUse: [{ command: cmd("edit") }], stop: [{ command: cmd("stop"), loop_limit: 1 }] },
    });
    const copilot = addAgentHooks({}, "copilot", cmd);
    expect(Object.keys(copilot.hooks as object)).toEqual(["postToolUse", "agentStop"]);
    expect(removeAgentHooks(copilot)).toEqual({ version: 1 });
  });

  it("uses Gemini's event names", () => {
    const g = addAgentHooks({}, "gemini", cmd);
    expect(Object.keys(g.hooks as object)).toEqual(["BeforeAgent", "AfterTool", "AfterAgent"]);
  });
});

describe("MCP entries and instruction files", () => {
  it("adds and removes our MCP server only", () => {
    const start = { mcpServers: { other: { command: "x" } } };
    const added = addMcpServer(start, "mcpServers", ["node", "cli.js", "serve", "/repo"]);
    expect(added.mcpServers).toEqual({ other: { command: "x" }, "context-pilot": { command: "node", args: ["cli.js", "serve", "/repo"] } });
    expect(removeMcpServer(added, "mcpServers")).toEqual(start);
    expect(addMcpServer({}, "servers", ["context-pilot", "serve"]).servers).toEqual({
      "context-pilot": { type: "stdio", command: "context-pilot", args: ["serve"] },
    });
  });

  it("makes Gemini read AGENTS.md as well as GEMINI.md", () => {
    expect(geminiReadsAgentsMd({})).toEqual({ context: { fileName: ["GEMINI.md", "AGENTS.md"] } });
    const once = geminiReadsAgentsMd({ context: { fileName: "CTX.md" } });
    expect(geminiReadsAgentsMd(once)).toEqual(once);
  });

  it("keeps a replaceable block in Codex's config.toml and in AGENTS.md", () => {
    const toml = codexMcpBlock('model = "o4"\n', ["node", "C:/cli.js", "serve", "C:/repo"])!;
    expect(toml).toContain('[mcp_servers.context-pilot]\ncommand = "node"\nargs = ["C:/cli.js", "serve", "C:/repo"]');
    expect(codexMcpBlock(toml, ["node", "x"])!.match(/mcp_servers/g)).toHaveLength(1);
    expect(codexMcpBlock(toml, null)).toBe('model = "o4"\n');

    const md = agentsMdBlock("# My repo\n\nRules.\n", true)!;
    expect(md.startsWith("# My repo\n\nRules.\n")).toBe(true);
    expect(agentsMdBlock(md, true)).toBe(md);
    expect(agentsMdBlock(md, false)).toBe("# My repo\n\nRules.\n");
    expect(agentsMdBlock(agentsMdBlock(null, true), false)).toBeNull();
  });
});
