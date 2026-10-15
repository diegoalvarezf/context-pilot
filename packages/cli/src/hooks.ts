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

/** Removes our Stop hook from Claude Code settings, dropping groups and keys left empty. */
export function removeClaudeStopHook(settings: ClaudeSettings): ClaudeSettings {
  const groups = settings.hooks?.Stop;
  if (!groups) return settings;
  const kept = groups
    .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !isOurs(h)) }))
    .filter((g) => g.hooks.length > 0);
  const hooks = { ...settings.hooks };
  if (kept.length) hooks.Stop = kept;
  else delete hooks.Stop;
  const next: ClaudeSettings = { ...settings, hooks };
  if (Object.keys(hooks).length === 0) delete next.hooks;
  return next;
}

/** Adds (or replaces) our Stop hook, keeping every other setting and hook. */
export function addClaudeStopHook(settings: ClaudeSettings, command: string): ClaudeSettings {
  const base = removeClaudeStopHook(settings);
  const hooks = { ...base.hooks };
  hooks.Stop = [...(hooks.Stop ?? []), { hooks: [{ type: "command", command }] }];
  return { ...base, hooks };
}

export function hasClaudeStopHook(settings: ClaudeSettings): boolean {
  return (settings.hooks?.Stop ?? []).some((g) => (g.hooks ?? []).some(isOurs));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
