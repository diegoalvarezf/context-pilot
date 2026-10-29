// Pure pieces of `context-pilot doctor`: reading the plugin registry and hook
// configs, and judging what the probes found. The command does the I/O.

export type CheckStatus = "ok" | "warn" | "fail";

export interface Check {
  status: CheckStatus;
  title: string;
  detail?: string;
  /** What to run or change to fix it */
  fix?: string;
}

export interface PluginInstall {
  version: string;
  installPath: string;
  scope: string;
}

/** Our entry in Claude Code's ~/.claude/plugins/installed_plugins.json, if any. */
export function contextPilotPlugin(registry: unknown): PluginInstall | null {
  const plugins = (registry as { plugins?: Record<string, unknown> })?.plugins ?? (registry as Record<string, unknown>);
  if (!plugins || typeof plugins !== "object") return null;
  for (const [key, value] of Object.entries(plugins)) {
    if (!key.startsWith("context-pilot@")) continue;
    const entry = (Array.isArray(value) ? value[0] : value) as Partial<PluginInstall> | undefined;
    if (entry?.installPath) return { version: entry.version ?? "?", installPath: entry.installPath, scope: entry.scope ?? "user" };
  }
  return null;
}

/** The command of the first hook for `event` in a Claude-style hooks config whose command mentions `needle`. */
export function hookCommand(config: unknown, event: string, needle = " on "): string | null {
  const groups = (config as { hooks?: Record<string, unknown> })?.hooks?.[event];
  if (!Array.isArray(groups)) return null;
  for (const g of groups as { hooks?: { command?: string }[] }[]) {
    for (const h of g.hooks ?? []) if (typeof h.command === "string" && h.command.includes(needle)) return h.command;
  }
  return null;
}

/** A global `context-pilot` that resolves into a source checkout instead of an npm install. */
export function isDevLink(realBinPath: string): boolean {
  return !realBinPath.replace(/\\/g, "/").includes("/node_modules/context-pilot/");
}

/** The version pinned in a hook or MCP command (`context-pilot@0.6.1`), if any. */
export function pinnedVersion(command: string): string | null {
  return /context-pilot@(\d+\.\d+\.\d+[\w.-]*)/.exec(command)?.[1] ?? null;
}

/** JSON-RPC messages a stdio MCP server printed; incomplete or non-JSON lines are ignored. */
export function mcpResponses(stdout: string): { id?: number; result?: unknown; error?: unknown }[] {
  const out: { id?: number; result?: unknown; error?: unknown }[] = [];
  for (const line of stdout.split("\n")) {
    try {
      const m = JSON.parse(line);
      if (m && typeof m === "object") out.push(m);
    } catch {
      // stray output
    }
  }
  return out;
}

export function mcpCheck(stdout: string, stderr: string, ms: number, timedOut: boolean): Check {
  const msgs = mcpResponses(stdout);
  const init = msgs.find((m) => m.id === 1);
  const tools = msgs.find((m) => m.id === 2)?.result as { tools?: { name: string }[] } | undefined;
  const lastErr = stderr.trim().split("\n").filter(Boolean).pop();
  if (!init?.result) {
    return {
      status: "fail",
      title: "MCP server does not start",
      detail: timedOut ? `no answer in ${Math.round(ms / 1000)}s` : (lastErr ?? "it closed without answering"),
      fix: "Run the server command shown above by hand to see the error",
    };
  }
  const names = tools?.tools?.map((t) => t.name) ?? [];
  return { status: "ok", title: `MCP server starts in ${ms}ms`, detail: names.length ? `${names.length} tools: ${names.join(", ")}` : undefined };
}

export function hookRunCheck(event: string, exitCode: number | null, ms: number, stderr: string, timedOut: boolean): Check {
  if (timedOut) return { status: "fail", title: `\`on ${event}\` hook times out`, detail: `no answer in ${Math.round(ms / 1000)}s` };
  if (exitCode !== 0) {
    return {
      status: "fail",
      title: `\`on ${event}\` hook exits with ${exitCode}`,
      detail: stderr.trim().split("\n").pop(),
    };
  }
  return { status: ms > 5000 ? "warn" : "ok", title: `\`on ${event}\` hook answers in ${ms}ms`, detail: ms > 5000 ? "slow: agents wait for it" : undefined };
}

export function indexCheck(
  status: { indexed: boolean; files?: number; indexedAt?: number; history?: { commitsProcessed: number; minedAt: number } },
  now = Date.now()
): Check {
  if (!status.indexed) {
    return { status: "warn", title: "Project not indexed yet", detail: "the first hook call will index it (slow once)", fix: "context-pilot index" };
  }
  const age = status.indexedAt ? Math.round((now - status.indexedAt) / 60000) : null;
  const history = status.history ? `, ${status.history.commitsProcessed} commits of history` : ", no git history mined";
  return {
    status: status.history ? "ok" : "warn",
    title: `Project indexed: ${status.files ?? 0} files${history}`,
    detail: age !== null ? `indexed ${age < 60 ? `${age} min` : `${Math.round(age / 60)} h`} ago` : undefined,
    fix: status.history ? undefined : "context-pilot index",
  };
}

/** npm package name of a global bin link target such as ../lib/node_modules/@scope/name/dist/index.js */
export function globalPackageName(linkTarget: string): string | null {
  const m = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(linkTarget.replace(/\\/g, "/"));
  return m?.[1] ?? null;
}
