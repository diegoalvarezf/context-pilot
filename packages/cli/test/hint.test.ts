import { describe, expect, it } from "vitest";
import {
  editedFile,
  EMPTY_HINT_STATE,
  formatHint,
  hookOutput,
  pickHints,
  recordHint,
  stateFileName,
  type HintCandidate,
} from "../src/hint.js";
import { addClaudeHook, hasClaudeHook, removeClaudeHook } from "../src/hooks.js";

const c = (path: string, score: number, isTest = false): HintCandidate => ({
  path,
  score,
  isTest,
  reasons: [`changed together in ${Math.round(score * 10)} of 10 commits`],
});

describe("pickHints", () => {
  const candidates = [c("a.ts", 0.4), c("b.test.ts", 0.9, true), c("c.ts", 0.7), c("d.ts", 0.6)];

  it("keeps strong candidates, strongest first, up to the limit", () => {
    expect(pickHints(candidates, EMPTY_HINT_STATE, { minScore: 0.5, limit: 2 }).map((h) => h.path)).toEqual([
      "b.test.ts",
      "c.ts",
    ]);
  });

  it("never repeats a hint nor suggests a file already edited", () => {
    const state = { edited: ["c.ts"], hinted: ["b.test.ts"] };
    expect(pickHints(candidates, state, { minScore: 0.5, limit: 3 }).map((h) => h.path)).toEqual(["d.ts"]);
  });
});

describe("recordHint", () => {
  it("remembers the edited file and what was suggested, without duplicates", () => {
    const s1 = recordHint(EMPTY_HINT_STATE, "x.ts", [c("y.ts", 0.8)]);
    const s2 = recordHint(s1, "x.ts", [c("y.ts", 0.8), c("z.ts", 0.7)]);
    expect(s2).toEqual({ edited: ["x.ts"], hinted: ["y.ts", "z.ts"] });
  });
});

describe("hook payloads", () => {
  it("reads the edited file from Edit/Write and NotebookEdit input", () => {
    expect(editedFile({ tool_input: { file_path: "/r/a.ts" } })).toBe("/r/a.ts");
    expect(editedFile({ tool_input: { notebook_path: "/r/n.ipynb" } })).toBe("/r/n.ipynb");
    expect(editedFile({ tool_input: {} })).toBeNull();
    expect(editedFile({})).toBeNull();
  });

  it("injects context through hookSpecificOutput", () => {
    const text = formatHint("src/auth.ts", [c("test/auth.test.ts", 0.82, true)]);
    expect(text).toContain("- test/auth.test.ts [test] (82%)");
    expect(JSON.parse(hookOutput(text))).toEqual({
      hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: text },
    });
  });

  it("turns session ids into safe file names", () => {
    expect(stateFileName("abc-123")).toBe("hints-abc-123.json");
    expect(stateFileName("../../etc")).toBe("hints-______etc.json");
    expect(stateFileName("")).toBe("hints-default.json");
  });
});

describe("Claude Code PostToolUse hook in settings", () => {
  it("adds it with the edit-tools matcher next to other hooks and removes only ours", () => {
    const settings = { hooks: { PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "lint" }] }] } };
    const added = addClaudeHook(settings, "PostToolUse", "cp hint --claude-hook", "Edit|Write");
    expect(added.hooks?.PostToolUse).toHaveLength(2);
    expect(added.hooks?.PostToolUse?.[1]).toEqual({
      matcher: "Edit|Write",
      hooks: [{ type: "command", command: "cp hint --claude-hook" }],
    });
    expect(hasClaudeHook(added, "PostToolUse")).toBe(true);
    expect(hasClaudeHook(added, "Stop")).toBe(false);
    expect(removeClaudeHook(added, "PostToolUse")).toEqual(settings);
  });
});
