// Pure helpers to add/remove context-pilot from a git hook script and Claude Code settings.

export const HOOK_START = "# >>> context-pilot >>>";
export const HOOK_END = "# <<< context-pilot <<<";
/** Marker in the Claude Code hook command, used to find our entry again */
export const CLAUDE_HOOK_FLAG = "--claude-hook";

/** Quotes a path for a POSIX shell script (git hooks run under sh, also on Windows) */
export function shQuote(s: string): string {
  return `'${s.replace(/\\/g, "/").replace(/'/g, `'\\''`)}'`;
}

/** Adds (or replaces) our block in a hook script. `existing` is null when there is no hook yet. */
export function addHookBlock(existing: string | null, command: string): string {
  const block = `${HOOK_START}\n${command}\n${HOOK_END}\n`;
  if (existing === null || !existing.trim()) return `#!/bin/sh\n${block}`;
  const base = removeHookBlock(existing) ?? "#!/bin/sh\n";
  // An `exit` at the end of someone else's hook would skip us: insert before it
  const lines = base.replace(/\n+$/, "").split("\n");
  const last = lines[lines.length - 1].trim();
  if (/^exit\b/.test(last)) {
    lines.splice(lines.length - 1, 0, block.trimEnd());
    return `${lines.join("\n")}\n`;
  }
  return `${lines.join("\n")}\n${block}`;
}

/** Removes our block. Returns null when nothing but a shebang would be left (delete the file). */
export function removeHookBlock(existing: string): string | null {
  const re = new RegExp(`${escapeRe(HOOK_START)}[\\s\\S]*?${escapeRe(HOOK_END)}\\n?`, "g");
  const rest = existing.replace(re, "");
  return rest.replace(/^#!.*\n?/, "").trim() ? rest : null;
}

export function hasHookBlock(existing: string | null): boolean {
  return !!existing && existing.includes(HOOK_START);
}

interface ClaudeCommandHook {
  type: string;
  command?: string;
  [k: string]: unknown;
}
interface ClaudeHookGroup {
  matcher?: string;
  hooks?: ClaudeCommandHook[];
  [k: string]: unknown;
}
export interface ClaudeSettings {
  hooks?: Record<string, ClaudeHookGroup[] | undefined>;
  [k: string]: unknown;
}

const isOurs = (h: ClaudeCommandHook) => typeof h.command === "string" && h.command.includes(CLAUDE_HOOK_FLAG);

/** Claude Code hook events we install: Stop runs `check`, PostToolUse runs `hint` after edits */
export type ClaudeHookEvent = "Stop" | "PostToolUse";

/** Tools that edit files, for the PostToolUse matcher */
export const EDIT_TOOLS_MATCHER = "Edit|Write|MultiEdit|NotebookEdit";

/** Removes our hook for `event` from Claude Code settings, dropping groups and keys left empty. */
export function removeClaudeHook(settings: ClaudeSettings, event: ClaudeHookEvent): ClaudeSettings {
  const groups = settings.hooks?.[event];
  if (!groups) return settings;
  const kept = groups
    .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !isOurs(h)) }))
    .filter((g) => g.hooks.length > 0);
  const hooks = { ...settings.hooks };
  if (kept.length) hooks[event] = kept;
  else delete hooks[event];
  const next: ClaudeSettings = { ...settings, hooks };
  if (Object.keys(hooks).length === 0) delete next.hooks;
  return next;
}

/** Adds (or replaces) our hook for `event`, keeping every other setting and hook. */
export function addClaudeHook(
  settings: ClaudeSettings,
  event: ClaudeHookEvent,
  command: string,
  matcher?: string
): ClaudeSettings {
  const base = removeClaudeHook(settings, event);
  const hooks = { ...base.hooks };
  const group: ClaudeHookGroup = { ...(matcher ? { matcher } : {}), hooks: [{ type: "command", command }] };
  hooks[event] = [...(hooks[event] ?? []), group];
  return { ...base, hooks };
}

export function hasClaudeHook(settings: ClaudeSettings, event: ClaudeHookEvent): boolean {
  return (settings.hooks?.[event] ?? []).some((g) => (g.hooks ?? []).some(isOurs));
}

export const removeClaudeStopHook = (s: ClaudeSettings) => removeClaudeHook(s, "Stop");
export const addClaudeStopHook = (s: ClaudeSettings, command: string) => addClaudeHook(s, "Stop", command);
export const hasClaudeStopHook = (s: ClaudeSettings) => hasClaudeHook(s, "Stop");

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
