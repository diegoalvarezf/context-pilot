// One hook command for every coding agent. Each agent sends its own JSON on
// stdin and expects its own JSON back; this file translates both ways, so the
// logic (pilot, find, hint, check) is written once.

export type Agent = "claude" | "codex" | "cursor" | "gemini" | "copilot";
export const AGENTS: Agent[] = ["claude", "codex", "cursor", "gemini", "copilot"];

/**
 * When context-pilot steps in:
 * - prompt: the user gave a task → the map of where to look
 * - search: the agent is about to grep for a name → where it's defined and used
 * - edit: the agent edited a file → what usually changes with it
 * - stop: the agent says it's done → files that look forgotten
 */
export type HookEvent = "prompt" | "search" | "edit" | "stop";
export const HOOK_EVENTS: HookEvent[] = ["prompt", "search", "edit", "stop"];

export interface HookInput {
  sessionId: string;
  cwd: string | null;
  prompt: string | null;
  toolName: string | null;
  toolInput: Record<string, unknown>;
  /** The agent is already continuing because of a stop hook: never block again */
  stopActive: boolean;
}

export interface HookReply {
  stdout?: string;
  stderr?: string;
  exitCode: number;
}

function asObject(v: unknown): Record<string, unknown> {
  if (typeof v === "string") {
    try {
      return asObject(JSON.parse(v));
    } catch {
      return {};
    }
  }
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

export function parseHookInput(raw: string): HookInput {
  const j = asObject(raw || "{}");
  return {
    sessionId: str(j.session_id) ?? str(j.conversation_id) ?? str(j.sessionId) ?? "default",
    cwd: str(j.cwd) ?? (Array.isArray(j.workspace_roots) ? str(j.workspace_roots[0]) : null),
    prompt: str(j.prompt) ?? str(j.user_prompt) ?? str(j.userPrompt),
    toolName: str(j.tool_name) ?? str(j.toolName),
    toolInput: asObject(j.tool_input ?? j.toolArgs ?? j.toolInput),
    stopActive: j.stop_hook_active === true || (typeof j.loop_count === "number" && j.loop_count > 0),
  };
}

const PATH_KEYS = ["file_path", "notebook_path", "path", "target_file", "filePath", "filename", "absolute_path"];

/** Files a tool call edited: a path field, or the files named in an apply_patch (Codex) patch. */
export function editedFiles(input: HookInput): string[] {
  const out = new Set<string>();
  for (const k of PATH_KEYS) {
    const v = str(input.toolInput[k]);
    if (v) out.add(v);
  }
  const patch = str(input.toolInput.patch) ?? str(input.toolInput.input) ?? str(input.toolInput.command);
  if (patch?.includes("*** ")) {
    for (const m of patch.matchAll(/^\*\*\* (?:Update|Add) File: (.+)$/gm)) out.add(m[1].trim());
  }
  return [...out];
}

/** The name an agent is grepping for, when it looks like an identifier; null otherwise. */
export function searchedName(input: HookInput): string | null {
  const tool = (input.toolName ?? "").toLowerCase();
  let pattern: string | null = null;
  if (tool === "grep" || tool === "search" || tool === "search_file_content" || tool === "grep_search") {
    pattern = str(input.toolInput.pattern) ?? str(input.toolInput.query);
  } else if (tool === "bash" || tool === "shell" || tool === "run_shell_command") {
    pattern = shellSearchPattern(str(input.toolInput.command) ?? "");
  }
  if (!pattern) return null;
  const name = pattern.replace(/^\\b|\\b$/g, "").replace(/^\^|\$$/g, "").replace(/\\\(|\(|\\s\*.*$/g, "");
  return /^[A-Za-z_$][\w$]{2,}$/.test(name) ? name : null;
}

// Options of grep/rg that take a value as the next word
const VALUE_FLAGS = new Set(["-A", "-B", "-C", "-m", "-g", "-t", "-T", "--glob", "--type", "--include", "--exclude", "--max-count"]);

/** The pattern of the first grep / rg / ag / ack / git grep in a shell command. */
export function shellSearchPattern(command: string): string | null {
  // First command of a pipeline / list, words with quotes removed
  const words = [...command.split(/[|;&]/)[0].matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
  let i = words.findIndex((w) => ["rg", "grep", "egrep", "ag", "ack"].includes(w));
  if (i < 0) {
    i = words.findIndex((w, k) => w === "grep" && words[k - 1] === "git");
    if (i < 0) return null;
  }
  for (let k = i + 1; k < words.length; k++) {
    const w = words[k];
    if (w === "-e" || w === "--regexp") return words[k + 1] ?? null;
    if (w.startsWith("-")) {
      if (VALUE_FLAGS.has(w)) k++;
      continue;
    }
    return w;
  }
  return null;
}

/** Which events each agent supports with a way to talk back to the model. */
export const SUPPORTED: Record<Agent, HookEvent[]> = {
  claude: ["prompt", "search", "edit", "stop"],
  codex: ["prompt", "edit", "stop"],
  gemini: ["prompt", "edit", "stop"],
  cursor: ["edit", "stop"],
  copilot: ["edit", "stop"],
};

const CLAUDE_EVENT: Record<HookEvent, string> = {
  prompt: "UserPromptSubmit",
  search: "PreToolUse",
  edit: "PostToolUse",
  stop: "Stop",
};
const GEMINI_EVENT: Record<HookEvent, string> = {
  prompt: "BeforeAgent",
  search: "BeforeTool",
  edit: "AfterTool",
  stop: "AfterAgent",
};

/** What to print so the agent's model sees `text`. Stop replies ask the agent to keep going and review. */
export function formatReply(agent: Agent, event: HookEvent, text: string): HookReply {
  if (event === "stop") {
    switch (agent) {
      case "cursor":
        return { stdout: JSON.stringify({ followup_message: text }), exitCode: 0 };
      case "gemini":
        return { stdout: JSON.stringify({ decision: "deny", reason: text }), exitCode: 0 };
      default:
        return { stdout: JSON.stringify({ decision: "block", reason: text }), exitCode: 0 };
    }
  }
  switch (agent) {
    case "cursor":
      return { stdout: JSON.stringify({ additional_context: text }), exitCode: 0 };
    case "copilot":
      return { stdout: JSON.stringify({ additionalContext: text }), exitCode: 0 };
    case "gemini":
      return {
        stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: GEMINI_EVENT[event], additionalContext: text } }),
        exitCode: 0,
      };
    default:
      return {
        stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: CLAUDE_EVENT[event], additionalContext: text } }),
        exitCode: 0,
      };
  }
}
