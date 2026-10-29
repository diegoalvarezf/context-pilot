import type { Agent, HookEvent } from "./agents.js";
import { SUPPORTED } from "./agents.js";

// Pure edits of each agent's config files: add or remove only our entries,
// keep everything else as it was. Our hook commands are recognised by a flag.

export const HOOK_FLAG = "--hook";
const LEGACY_FLAG = "--claude-hook";

type Json = Record<string, unknown>;
interface CommandHook {
  type?: string;
  command?: string;
  bash?: string;
  [k: string]: unknown;
}
interface HookGroup {
  matcher?: string;
  hooks?: CommandHook[];
  [k: string]: unknown;
}

const isOurCommand = (c: unknown) =>
  typeof c === "string" && (c.includes(LEGACY_FLAG) || (/ on (prompt|search|edit|stop) /.test(c) && c.includes(` ${HOOK_FLAG}`)));
const isOurs = (h: CommandHook) => isOurCommand(h.command) || isOurCommand(h.bash);

/** Event names and tool matchers per agent, for agents using Claude-style hook groups. */
const GROUP_EVENTS: Partial<Record<Agent, Partial<Record<HookEvent, { event: string; matcher?: string }>>>> = {
  claude: {
    prompt: { event: "UserPromptSubmit" },
    search: { event: "PreToolUse", matcher: "Grep" },
    edit: { event: "PostToolUse", matcher: "Edit|Write|MultiEdit|NotebookEdit" },
    stop: { event: "Stop" },
  },
  codex: {
    prompt: { event: "UserPromptSubmit" },
    edit: { event: "PostToolUse", matcher: "apply_patch|Edit|Write" },
    stop: { event: "Stop" },
  },
  gemini: {
    prompt: { event: "BeforeAgent" },
    edit: { event: "AfterTool", matcher: "write_file|replace|edit" },
    stop: { event: "AfterAgent" },
  },
};

const FLAT_EVENTS: Partial<Record<Agent, Partial<Record<HookEvent, string>>>> = {
  cursor: { edit: "postToolUse", stop: "stop" },
  copilot: { edit: "postToolUse", stop: "agentStop" },
};

function withoutOurHooks(config: Json): Json {
  const hooks = { ...((config.hooks as Record<string, unknown[]>) ?? {}) };
  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) continue;
    const kept = entries
      .map((e) => {
        const g = e as HookGroup;
        // Claude-style groups hold a list of hooks; flat entries (Cursor, Copilot) are hooks themselves
        if (Array.isArray(g.hooks)) return { ...g, hooks: g.hooks.filter((h) => !isOurs(h)) };
        return isOurs(g as CommandHook) ? null : g;
      })
      .filter((g): g is HookGroup => g !== null && (!Array.isArray(g.hooks) || g.hooks.length > 0));
    if (kept.length) hooks[event] = kept;
    else delete hooks[event];
  }
  const next: Json = { ...config, hooks };
  if (Object.keys(hooks).length === 0) delete next.hooks;
  return next;
}

/** Our hooks in an agent's hook config. `command(event)` is the shell command for that event. */
export function addAgentHooks(config: Json, agent: Agent, command: (e: HookEvent) => string, events?: HookEvent[]): Json {
  const base = withoutOurHooks(config);
  const hooks = { ...((base.hooks as Record<string, unknown[]>) ?? {}) };
  const wanted = (events ?? SUPPORTED[agent]).filter((e) => SUPPORTED[agent].includes(e));

  for (const e of wanted) {
    const grouped = GROUP_EVENTS[agent]?.[e];
    const flat = FLAT_EVENTS[agent]?.[e];
    if (grouped) {
      const hook: CommandHook = { type: "command", command: command(e) };
      if (agent === "gemini") hook.timeout = 60_000;
      hooks[grouped.event] = [...(hooks[grouped.event] ?? []), { ...(grouped.matcher ? { matcher: grouped.matcher } : {}), hooks: [hook] }];
    } else if (flat) {
      const entry: CommandHook =
        agent === "copilot"
          ? { type: "command", bash: command(e), powershell: command(e), timeoutSec: 60 }
          : { command: command(e), ...(e === "stop" ? { loop_limit: 1 } : {}) };
      hooks[flat] = [...(hooks[flat] ?? []), entry];
    }
  }
  const next: Json = { ...base, hooks };
  if (FLAT_EVENTS[agent]) next.version = (base.version as number | undefined) ?? 1;
  return next;
}

export function removeAgentHooks(config: Json): Json {
  return withoutOurHooks(config);
}

export function hasAgentHooks(config: Json): boolean {
  return JSON.stringify(withoutOurHooks(config)) !== JSON.stringify(config);
}

// ── MCP server entries ────────────────────────────────────────────────────────

export const MCP_NAME = "context-pilot";

/** `mcpServers` (Cursor, Gemini, Copilot CLI) or `servers` (VS Code) entry. */
export function addMcpServer(config: Json, key: "mcpServers" | "servers", argv: string[]): Json {
  const [command, ...args] = argv;
  const servers = { ...((config[key] as Json) ?? {}) };
  servers[MCP_NAME] = key === "servers" ? { type: "stdio", command, args } : { command, args };
  return { ...config, [key]: servers };
}

export function removeMcpServer(config: Json, key: "mcpServers" | "servers"): Json {
  const servers = { ...((config[key] as Json) ?? {}) };
  if (!(MCP_NAME in servers)) return config;
  delete servers[MCP_NAME];
  const next = { ...config, [key]: servers };
  if (Object.keys(servers).length === 0) delete next[key];
  return next;
}

/** Gemini reads GEMINI.md by default: also make it read AGENTS.md. */
export function geminiReadsAgentsMd(config: Json): Json {
  const context = { ...((config.context as Json) ?? {}) };
  const current = context.fileName;
  const names = Array.isArray(current) ? (current as string[]) : typeof current === "string" ? [current] : ["GEMINI.md"];
  if (names.includes("AGENTS.md")) return config;
  return { ...config, context: { ...context, fileName: [...names, "AGENTS.md"] } };
}

// ── Marked text blocks (Codex config.toml, AGENTS.md) ─────────────────────────

const TOML_START = "# >>> context-pilot >>>";
const TOML_END = "# <<< context-pilot <<<";
const MD_START = "<!-- context-pilot:start -->";
const MD_END = "<!-- context-pilot:end -->";

const tomlString = (s: string) => JSON.stringify(s);

function replaceBlock(text: string | null, start: string, end: string, body: string | null): string | null {
  const re = new RegExp(`\\n?${escapeRe(start)}[\\s\\S]*?${escapeRe(end)}\\n?`, "g");
  const rest = (text ?? "").replace(re, "\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "").replace(/\n+$/, "");
  if (body === null) return rest.trim() ? `${rest}\n` : null;
  return `${rest.trim() ? `${rest}\n\n` : ""}${start}\n${body}\n${end}\n`;
}

export function codexMcpBlock(text: string | null, argv: string[] | null): string | null {
  if (!argv) return replaceBlock(text, TOML_START, TOML_END, null);
  const [command, ...args] = argv;
  const body = `[mcp_servers.${MCP_NAME}]\ncommand = ${tomlString(command)}\nargs = [${args.map(tomlString).join(", ")}]`;
  return replaceBlock(text, TOML_START, TOML_END, body);
}

export const AGENTS_MD_TEXT = `## context-pilot

This repo has the context-pilot MCP server. It indexes the code and learns from git history which files change together.

- Before exploring the code for a task, call \`pilot\` with the task in plain words: it returns the files that matter, their functions with line ranges, related files and tests. Read only the ranges you need.
- To find where a function, class or constant is defined and used, call \`find_symbol\` instead of grepping.
- To see what a file contains, call \`outline\` instead of reading it whole.
- Before saying a change is done, call \`check_change\`: it lists files that usually change with yours and are missing.`;

export function agentsMdBlock(text: string | null, add: boolean): string | null {
  return replaceBlock(text, MD_START, MD_END, add ? AGENTS_MD_TEXT : null);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
