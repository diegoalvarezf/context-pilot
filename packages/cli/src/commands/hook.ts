import { Command } from "commander";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import chalk from "chalk";
import { gitHooksDir } from "context-pilot-engine";
import { CLI_VERSION } from "../version.js";
import {
  addClaudeStopHook,
  addHookBlock,
  CLAUDE_HOOK_FLAG,
  hasClaudeStopHook,
  hasHookBlock,
  removeClaudeStopHook,
  removeHookBlock,
  shQuote,
  type ClaudeSettings,
} from "../hooks.js";

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

function claudeSettingsPath(root: string): string {
  // Local settings: the command holds machine-specific paths, so it must not be committed
  return join(root, ".claude", "settings.local.json");
}

function readJson(path: string): ClaudeSettings {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as ClaudeSettings) : {};
}

async function preCommitPath(root: string): Promise<string> {
  const dir = await gitHooksDir(root);
  if (!dir) throw new Error(`not a git repository: ${root}`);
  return join(dir, "pre-commit");
}

export async function installHooks(root: string, opts: { strict: boolean; claude: boolean }): Promise<void> {
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

  if (opts.claude) {
    const path = claudeSettingsPath(root);
    const settings = readJson(path);
    const command = `${launcher.map((a) => `"${a}"`).join(" ")} check ${CLAUDE_HOOK_FLAG} -p "${root.replace(/\\/g, "/")}"`;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(addClaudeStopHook(settings, command), null, 2) + "\n");
    console.log(chalk.green(hasClaudeStopHook(settings) ? "Updated" : "Installed") + ` Claude Code Stop hook: ${path}`);
    console.log(chalk.dim("  When Claude finishes, likely-missing files are sent back to it to review."));
  }
}

const install = new Command("install")
  .description("Run `context-pilot check` before each commit (and, with --claude, when Claude Code finishes)")
  .option("-p, --project <path>", "Project root path", ".")
  .option("--strict", "Block the commit when files look missing (skip once with git commit --no-verify)", false)
  .option("--claude", "Also add a Claude Code Stop hook to .claude/settings.local.json", false)
  .action(async (options: { project: string; strict: boolean; claude: boolean }) => {
    await installHooks(resolve(options.project), options);
  });

const uninstall = new Command("uninstall")
  .description("Remove the context-pilot pre-commit and Claude Code hooks")
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

    const path = claudeSettingsPath(root);
    const settings = readJson(path);
    if (hasClaudeStopHook(settings)) {
      writeFileSync(path, JSON.stringify(removeClaudeStopHook(settings), null, 2) + "\n");
      console.log(chalk.green("Removed") + ` Claude Code Stop hook from ${path}`);
    }
  });

export const hookCommand = new Command("hook")
  .description("Install or remove hooks that run `context-pilot check` automatically")
  .addCommand(install)
  .addCommand(uninstall);
