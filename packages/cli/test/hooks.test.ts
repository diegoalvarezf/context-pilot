import { describe, expect, it } from "vitest";
import {
  addClaudeStopHook,
  addHookBlock,
  hasClaudeStopHook,
  hasHookBlock,
  HOOK_END,
  HOOK_START,
  removeClaudeStopHook,
  removeHookBlock,
  shQuote,
} from "../src/hooks.js";

const CMD = "'node' 'cli.js' check --staged || true";

describe("git hook block", () => {
  it("creates a new hook with a shebang", () => {
    expect(addHookBlock(null, CMD)).toBe(`#!/bin/sh\n${HOOK_START}\n${CMD}\n${HOOK_END}\n`);
  });

  it("appends to an existing hook and replaces its own block on reinstall", () => {
    const first = addHookBlock("#!/bin/sh\nnpm run lint\n", CMD);
    expect(first.startsWith("#!/bin/sh\nnpm run lint\n")).toBe(true);
    const second = addHookBlock(first, "other");
    expect(second.split(HOOK_START).length).toBe(2);
    expect(second).toContain("\nother\n");
    expect(second).not.toContain(CMD);
  });

  it("goes before a trailing exit so it still runs", () => {
    const out = addHookBlock("#!/bin/sh\nnpm test\nexit 0\n", CMD);
    expect(out.trimEnd().endsWith("exit 0")).toBe(true);
    expect(out.indexOf(HOOK_START)).toBeLessThan(out.indexOf("exit 0"));
  });

  it("removes only its block, or the whole file when nothing else is left", () => {
    expect(removeHookBlock(addHookBlock(null, CMD))).toBeNull();
    const mixed = removeHookBlock(addHookBlock("#!/bin/sh\nnpm run lint\n", CMD))!;
    expect(mixed).toBe("#!/bin/sh\nnpm run lint\n");
    expect(hasHookBlock(mixed)).toBe(false);
  });

  it("quotes paths for sh, with forward slashes", () => {
    expect(shQuote("C:\\Program Files\\node.exe")).toBe("'C:/Program Files/node.exe'");
    expect(shQuote("it's")).toBe(`'it'\\''s'`);
  });
});

describe("Claude Code Stop hook", () => {
  const ours = "node cli.js check --claude-hook -p /repo";
  const theirs = { hooks: [{ type: "command", command: "say done" }] };

  it("adds its hook while keeping other settings and hooks", () => {
    const settings = { permissions: { allow: ["Bash(ls)"] }, hooks: { Stop: [theirs], PreToolUse: [theirs] } };
    const out = addClaudeStopHook(settings, ours);
    expect(out.permissions).toEqual(settings.permissions);
    expect(out.hooks!.PreToolUse).toEqual([theirs]);
    expect(out.hooks!.Stop).toEqual([theirs, { hooks: [{ type: "command", command: ours }] }]);
    expect(hasClaudeStopHook(out)).toBe(true);
  });

  it("does not duplicate on reinstall and cleans up on removal", () => {
    const twice = addClaudeStopHook(addClaudeStopHook({}, ours), ours + " x");
    expect(twice.hooks!.Stop).toHaveLength(1);
    expect(removeClaudeStopHook(twice)).toEqual({});
    expect(removeClaudeStopHook(addClaudeStopHook({ hooks: { Stop: [theirs] } }, ours))).toEqual({
      hooks: { Stop: [theirs] },
    });
  });
});
