import { Command } from "commander";
import { spawnSync } from "child_process";
import { resolve } from "path";
import chalk from "chalk";
import ora from "ora";
import { ContextEngine, gitHooksDir } from "context-pilot-engine";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { AGENT_NAMES, installHooks, launcherArgv, parseAgents, runningFromNpx } from "./hook.js";
import { AGENTS, type Agent } from "../agents.js";

const MCP_NAME = "context-pilot";

function run(cmd: string, args: string[], cwd: string): { ok: boolean; out: string } {
  // shell on Windows so `claude.cmd` / `claude.exe` resolve from PATH
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", shell: process.platform === "win32" });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

const winQuote = (a: string) => (process.platform === "win32" && /[\s"]/.test(a) ? `"${a}"` : a);

const onPath = (cmd: string, root: string) => run(cmd, ["--version"], root).ok;

/** Agents that look installed: their CLI on PATH, or their config folder in the project or home. */
export function detectAgents(root: string): Agent[] {
  const home = homedir();
  const has = (...paths: string[]) => paths.some((p) => existsSync(p));
  const found: Agent[] = [];
  if (onPath("claude", root) || has(join(root, ".claude"), join(home, ".claude"))) found.push("claude");
  if (onPath("codex", root) || has(join(root, ".codex"), join(home, ".codex"))) found.push("codex");
  if (has(join(root, ".cursor"), join(home, ".cursor"))) found.push("cursor");
  if (onPath("gemini", root) || has(join(root, ".gemini"), join(home, ".gemini"))) found.push("gemini");
  if (onPath("copilot", root) || has(join(home, ".copilot"))) found.push("copilot");
  return found;
}

/** Registers the MCP server with Claude Code for this project (local scope). Replaces an older entry. */
function registerMcp(root: string): "added" | "no-claude" | { error: string } {
  if (!run("claude", ["--version"], root).ok) return "no-claude";
  run("claude", ["mcp", "remove", MCP_NAME, "-s", "local"], root);
  const serve = [...launcherArgv(), "serve", root.replace(/\\/g, "/")].map(winQuote);
  const r = run("claude", ["mcp", "add", "-s", "local", MCP_NAME, "--", ...serve], root);
  return r.ok ? "added" : { error: r.out };
}

export const setupCommand = new Command("setup")
  .description("One-shot setup: index code and history, then hooks and MCP server for every coding agent found")
  .argument("[path]", "Project root path", ".")
  .option("--strict", "Pre-commit hook blocks the commit when files look missing", false)
  .option("--agent <list>", `Agents to set up (default: the ones found): ${AGENTS.join(", ")}`)
  .option("--no-hooks", "Skip the git pre-commit and agent hooks")
  .option("--no-claude", "Skip everything Claude Code (hooks and MCP server)")
  .action(async (projectPath: string, options: { strict: boolean; hooks: boolean; claude: boolean; agent?: string }) => {
    const root = resolve(projectPath);
    if (!(await gitHooksDir(root))) {
      console.error(chalk.red(`Not a git repository: ${root}`) + chalk.dim(" — context-pilot learns from git history."));
      process.exitCode = 1;
      return;
    }

    console.log(chalk.bold(`Setting up context-pilot in ${root}\n`));

    const spinner = ora("Indexing code and mining git history (first run may take a minute)...").start();
    const engine = new ContextEngine();
    try {
      await engine.init();
      const result = await engine.index({ projectPath: root });
      if (!result.success) {
        spinner.fail(chalk.red("Indexing failed: ") + (result.error ?? "unknown error"));
        process.exitCode = 1;
        return;
      }
      const h = result.history;
      const commits = h?.status === "full" ? ` and ${h.commitsProcessed.toLocaleString()} commits` : "";
      spinner.succeed(`Indexed ${result.totalFiles.toLocaleString()} files${commits}`);
    } finally {
      engine.close();
    }

    let agents = options.agent ? parseAgents(options.agent) : detectAgents(root);
    if (!options.claude) agents = agents.filter((a) => a !== "claude");
    console.log(
      agents.length
        ? `Agents: ${agents.map((a) => AGENT_NAMES[a]).join(", ")}`
        : chalk.yellow("No coding agent found.") + chalk.dim(" Pass --agent claude,codex,cursor,gemini,copilot to choose.")
    );

    if (options.hooks) await installHooks(root, { strict: options.strict, agents });

    if (agents.includes("claude")) {
      const mcp = registerMcp(root);
      if (mcp === "added") console.log(chalk.green("Registered") + " MCP server with Claude Code (this project only)");
      else {
        const cmd = `claude mcp add -s local ${MCP_NAME} -- ${[...launcherArgv(), "serve", root].map(winQuote).join(" ")}`;
        console.log(chalk.yellow(mcp === "no-claude" ? "Claude Code CLI not found." : `Could not register the MCP server: ${mcp.error}`));
        console.log(chalk.dim("  To add it later: ") + chalk.white(cmd));
      }
    }

    console.log(chalk.green("\nDone.") + " Nothing else to do: your agent gets the map on its own. Try " + chalk.cyan('context-pilot pilot "<a task>"') + " to see it.");
    if (runningFromNpx()) {
      console.log(chalk.dim("Hooks run through npx; for faster hooks: npm i -g context-pilot && context-pilot setup"));
    }
    console.log(chalk.dim("Undo: context-pilot hook uninstall" + (agents.includes("claude") ? " && claude mcp remove -s local context-pilot" : "")));
  });
