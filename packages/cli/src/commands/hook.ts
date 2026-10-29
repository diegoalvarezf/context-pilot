import { Command } from "commander";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname, join, relative, resolve } from "path";
import chalk from "chalk";
import { gitHooksDir } from "context-pilot-engine";
import { CLI_VERSION } from "../version.js";
import { spawnSync } from "child_process";
import { addHookBlock, hasHookBlock, removeHookBlock, shQuote } from "../hooks.js";
import { AGENTS, type Agent, type HookEvent } from "../agents.js";
import {
  addAgentHooks,
  addMcpServer,
  agentsMdBlock,
  codexMcpBlock,
  geminiReadsAgentsMd,
  hasAgentHooks,
  HOOK_FLAG,
  removeAgentHooks,
  removeMcpServer,
} from "../agent-config.js";

/** True when running from the npx cache, which npm may clean at any time */
export function runningFromNpx(): boolean {
  return /[\\/]_npx[\\/]/.test(process.argv[1] ?? "");
}

/**
 * How hooks and the MCP server start this CLI, as argv. Absolute node + CLI paths so it works without
 * context-pilot on PATH (re-run setup after moving it); from npx, a pinned `npx -y` instead.
 */
export function launcherArgv(): string[] {
  if (runningFromNpx()) return ["npx", "-y", `context-pilot@${CLI_VERSION}`];
  return [process.execPath.replace(/\\/g, "/"), resolve(process.argv[1]).replace(/\\/g, "/")];
}

/**
 * For files a team may commit (Copilot's .github/ and .vscode/): no machine paths. The global
 * command when installed, else a pinned npx.
 */
export function portableLauncherArgv(): string[] {
  const r = spawnSync("context-pilot", ["--version"], { encoding: "utf8", shell: process.platform === "win32" });
  return r.status === 0 ? ["context-pilot"] : ["npx", "-y", `context-pilot@${CLI_VERSION}`];
}

type Json = Record<string, unknown>;

function readJson(path: string): Json {
  try {
    return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Json) : {};
  } catch {
    throw new Error(`${path} is not valid JSON; fix it or remove it and run setup again`);
  }
}

function writeJson(path: string, value: Json): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

/** Where each agent keeps its hooks for this project. Claude's is local: it holds machine paths. */
export function hookConfigPath(root: string, agent: Agent): string {
  switch (agent) {
    case "claude":
      return join(root, ".claude", "settings.local.json");
    case "codex":
      return join(root, ".codex", "hooks.json");
    case "cursor":
      return join(root, ".cursor", "hooks.json");
    case "gemini":
      return join(root, ".gemini", "settings.json");
    case "copilot":
      return join(root, ".github", "hooks", "context-pilot.json");
  }
}

const quoteAll = (argv: string[]) => argv.map((a) => (/[\s"]/.test(a) ? `"${a}"` : a)).join(" ");

/** Hooks and MCP server for one agent (Claude's MCP server is registered by `setup` through its CLI). */
export function installAgent(root: string, agent: Agent): string[] {
  const portable = agent === "copilot";
  const launcher = portable ? portableLauncherArgv() : launcherArgv();
  const project = portable ? "" : ` -p "${root.replace(/\\/g, "/")}"`;
  const command = (e: HookEvent) => `${quoteAll(launcher)} on ${e} ${HOOK_FLAG} --agent ${agent}${project}`;
  const serve = [...launcher, "serve", portable ? "${workspaceFolder}" : root.replace(/\\/g, "/")];
  const written: string[] = [];

  const hooksPath = hookConfigPath(root, agent);
  let hooks = addAgentHooks(readJson(hooksPath), agent, command);
  if (agent === "gemini") hooks = geminiReadsAgentsMd(addMcpServer(hooks, "mcpServers", serve));
  writeJson(hooksPath, hooks);
  written.push(hooksPath);

  if (agent === "cursor") {
    const mcp = join(root, ".cursor", "mcp.json");
    writeJson(mcp, addMcpServer(readJson(mcp), "mcpServers", serve));
    written.push(mcp);
  } else if (agent === "copilot") {
    const vscode = join(root, ".vscode", "mcp.json");
    writeJson(vscode, addMcpServer(readJson(vscode), "servers", serve));
    const cli = join(root, ".github", "mcp.json");
    writeJson(cli, addMcpServer(readJson(cli), "mcpServers", [...launcher, "serve"]));
    written.push(vscode, cli);
  } else if (agent === "codex") {
    const toml = join(root, ".codex", "config.toml");
    const next = codexMcpBlock(existsSync(toml) ? readFileSync(toml, "utf8") : null, serve);
    if (next) writeFileSync(toml, next);
    written.push(toml);
  }
  return written;
}

/** Writes what's left after removing our entries, or deletes the file (and its folder) when nothing is. */
function writeOrRemove(root: string, path: string, value: Json): void {
  if (Object.keys(value).some((k) => k !== "version")) return writeJson(path, value);
  rmSync(path);
  for (let dir = dirname(path); dir.length > root.length && readdirSync(dir).length === 0; dir = dirname(dir)) rmSync(dir, { recursive: true });
}

export function uninstallAgent(root: string, agent: Agent): string[] {
  const touched: string[] = [];
  const hooksPath = hookConfigPath(root, agent);
  if (existsSync(hooksPath)) {
    const config = readJson(hooksPath);
    let next = removeAgentHooks(config);
    if (agent === "gemini") {
      next = removeMcpServer(next, "mcpServers");
      // Undo the AGENTS.md entry only when it's exactly what setup wrote
      const ctx = next.context as Json | undefined;
      if (ctx && Object.keys(ctx).length === 1 && JSON.stringify(ctx.fileName) === '["GEMINI.md","AGENTS.md"]') {
        next = { ...next };
        delete next.context;
      }
    }
    if (JSON.stringify(next) !== JSON.stringify(config)) {
      writeOrRemove(root, hooksPath, next);
      touched.push(hooksPath);
    }
  }
  const mcpFiles: Array<[string, "mcpServers" | "servers"]> =
    agent === "cursor"
      ? [[join(root, ".cursor", "mcp.json"), "mcpServers"]]
      : agent === "copilot"
        ? [
            [join(root, ".vscode", "mcp.json"), "servers"],
            [join(root, ".github", "mcp.json"), "mcpServers"],
          ]
        : [];
  for (const [path, key] of mcpFiles) {
    if (!existsSync(path)) continue;
    const config = readJson(path);
    const next = removeMcpServer(config, key);
    if (next !== config) {
      writeOrRemove(root, path, next);
      touched.push(path);
    }
  }
  if (agent === "codex") {
    const toml = join(root, ".codex", "config.toml");
    if (existsSync(toml)) {
      const text = readFileSync(toml, "utf8");
      const next = codexMcpBlock(text, null);
      if (next !== text) {
        if (next === null) writeOrRemove(root, toml, {});
        else writeFileSync(toml, next);
        touched.push(toml);
      }
    }
  }
  return touched;
}

export function hasAgent(root: string, agent: Agent): boolean {
  const path = hookConfigPath(root, agent);
  return existsSync(path) && hasAgentHooks(readJson(path));
}

/** Instructions every agent reads (Codex, Cursor, Copilot, Gemini, Zed, Windsurf…), for those without hooks too. */
export function writeAgentsMd(root: string, add: boolean): boolean {
  const path = join(root, "AGENTS.md");
  const text = existsSync(path) ? readFileSync(path, "utf8") : null;
  const next = agentsMdBlock(text, add);
  if (next === text || (next === null && text === null)) return false;
  if (next === null) rmSync(path);
  else writeFileSync(path, next);
  return true;
}

async function preCommitPath(root: string): Promise<string> {
  const dir = await gitHooksDir(root);
  if (!dir) throw new Error(`not a git repository: ${root}`);
  return join(dir, "pre-commit");
}

export async function installHooks(root: string, opts: { strict: boolean; agents: Agent[] }): Promise<void> {
  const launcher = launcherArgv();
  const hookFile = await preCommitPath(root);
  const existing = existsSync(hookFile) ? readFileSync(hookFile, "utf8") : null;
  const cmd =
    `${launcher.map(shQuote).join(" ")} check --staged -p ${shQuote(root)}` +
    (opts.strict ? " --strict || exit 1" : " || true");

  mkdirSync(dirname(hookFile), { recursive: true });
  writeFileSync(hookFile, addHookBlock(existing, cmd));
  chmodSync(hookFile, 0o755);
  console.log(chalk.green(hasHookBlock(existing) ? "Updated" : "Installed") + ` pre-commit hook: ${hookFile}`);
  console.log(chalk.dim(opts.strict ? "  Commits are blocked when files look missing." : "  Warns only; never blocks a commit."));

  for (const agent of opts.agents) {
    const had = hasAgent(root, agent);
    const files = installAgent(root, agent);
    console.log(chalk.green(had ? "Updated" : "Installed") + ` ${AGENT_NAMES[agent]} hooks: ${files.map((f) => relative(root, f)).join(", ")}`);
  }
  if (writeAgentsMd(root, true)) console.log(chalk.green("Updated") + " AGENTS.md (how agents should use context-pilot)");
  if (opts.agents.length) {
    console.log(chalk.dim("  On each task the agent gets a map of where to look; before a grep for a name, where it lives;"));
    console.log(chalk.dim("  after an edit, what usually changes with it; when it finishes, files that look forgotten."));
  }
}

export const AGENT_NAMES: Record<Agent, string> = {
  claude: "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  gemini: "Gemini CLI",
  copilot: "GitHub Copilot",
};

export function parseAgents(list: string): Agent[] {
  const names = list.split(",").map((a) => a.trim().toLowerCase()).filter(Boolean);
  const bad = names.filter((a) => !AGENTS.includes(a as Agent));
  if (bad.length) throw new Error(`unknown agent(s): ${bad.join(", ")}. Use: ${AGENTS.join(", ")}`);
  return names as Agent[];
}

const install = new Command("install")
  .description("Run `context-pilot check` before each commit, and add hooks for coding agents (--agent)")
  .option("-p, --project <path>", "Project root path", ".")
  .option("--strict", "Block the commit when files look missing (skip once with git commit --no-verify)", false)
  .option("--claude", "Also add Claude Code hooks (same as --agent claude)", false)
  .option("--agent <list>", `Also add hooks for these agents: ${AGENTS.join(", ")}`)
  .action(async (options: { project: string; strict: boolean; claude: boolean; agent?: string }) => {
    const agents = new Set(options.agent ? parseAgents(options.agent) : []);
    if (options.claude) agents.add("claude");
    await installHooks(resolve(options.project), { strict: options.strict, agents: [...agents] });
  });

const uninstall = new Command("uninstall")
  .description("Remove the context-pilot pre-commit hook and every agent's hooks")
  .option("-p, --project <path>", "Project root path", ".")
  .action(async (options: { project: string }) => {
    const root = resolve(options.project);
    const hookFile = await preCommitPath(root);
    const existing = existsSync(hookFile) ? readFileSync(hookFile, "utf8") : null;
    if (existing !== null && hasHookBlock(existing)) {
      const rest = removeHookBlock(existing);
      if (rest === null) rmSync(hookFile);
      else writeFileSync(hookFile, rest);
      console.log(chalk.green("Removed") + ` pre-commit hook from ${hookFile}`);
    }

    for (const agent of AGENTS) {
      const touched = uninstallAgent(root, agent);
      if (touched.length) console.log(chalk.green("Removed") + ` ${AGENT_NAMES[agent]} hooks from ${touched.map((f) => relative(root, f)).join(", ")}`);
    }
    if (writeAgentsMd(root, false)) console.log(chalk.green("Removed") + " the context-pilot section from AGENTS.md");
  });

export const hookCommand = new Command("hook")
  .description("Install or remove hooks that run `context-pilot check` automatically")
  .addCommand(install)
  .addCommand(uninstall);
