import { Command } from "commander";
import { spawn, spawnSync } from "child_process";
import { readFileSync, readlinkSync, realpathSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";
import chalk from "chalk";
import { ContextEngine } from "context-pilot-engine";
import { AGENTS, type Agent } from "../agents.js";
import {
  contextPilotPlugin,
  globalPackageName,
  hookCommand,
  hookRunCheck,
  indexCheck,
  isDevLink,
  mcpCheck,
  pinnedVersion,
  type Check,
} from "../doctor.js";
import { filterTrace, readTrace } from "../trace.js";
import { CLI_VERSION } from "../version.js";
import { AGENT_NAMES, hasAgent, hookConfigPath, launcherArgv } from "./hook.js";
import { detectAgents } from "./setup.js";

export const DOCTOR_SESSION = "context-pilot-doctor";
const HOOK_TIMEOUT_MS = 90_000;
const MCP_TIMEOUT_MS = 30_000;

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function gitRoot(dir: string): string | null {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: dir, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

const quote = (argv: string[]) => argv.map((a) => (/[\s"]/.test(a) ? `"${a}"` : a)).join(" ");

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  ms: number;
  timedOut: boolean;
}

/** Runs a shell command with `input` on stdin; `until` ends it early once stdout says enough. */
function run(command: string, input: string, opts: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; until?: (out: string) => boolean; keepOpen?: boolean }): Promise<RunResult> {
  return new Promise((done) => {
    const started = Date.now();
    const child = spawn(command, { cwd: opts.cwd, env: opts.env, shell: true });
    let stdout = "";
    let stderr = "";
    let finished = false;
    const finish = (code: number | null, timedOut: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      child.kill();
      done({ code, stdout, stderr, ms: Date.now() - started, timedOut });
    };
    const timer = setTimeout(() => finish(null, true), opts.timeoutMs);
    child.stdout.on("data", (d) => {
      stdout += d;
      if (opts.until?.(stdout)) finish(0, false);
    });
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => {
      stderr += String(e);
      finish(null, false);
    });
    child.on("close", (code) => finish(code, false));
    child.stdin.write(input);
    if (!opts.keepOpen) child.stdin.end();
  });
}

function print(c: Check): void {
  const icon = c.status === "ok" ? chalk.green("✓") : c.status === "warn" ? chalk.yellow("!") : chalk.red("✗");
  console.log(`${icon} ${c.title}`);
  if (c.detail) console.log(chalk.dim(`    ${c.detail}`));
  if (c.fix) console.log(chalk.dim("    fix: ") + chalk.white(c.fix));
}

export const doctorCommand = new Command("doctor")
  .description("Check that context-pilot works here: install, hooks per agent, index, the hook command and the MCP server")
  .argument("[path]", "Project root path", ".")
  .option("--skip-run", "Don't run the hook and the MCP server (only static checks)", false)
  .action(async (projectPath: string, options: { skipRun: boolean }) => {
    const checks: Check[] = [];
    const add = (c: Check) => {
      checks.push(c);
      print(c);
    };
    const root = gitRoot(resolve(projectPath));
    console.log(chalk.bold(`context-pilot ${CLI_VERSION} doctor`) + chalk.dim(` · node ${process.versions.node}\n`));

    // ── Install ──────────────────────────────────────────────────────────────
    const [major, minor] = process.versions.node.split(".").map(Number);
    if (major < 22 || (major === 22 && minor < 13)) add({ status: "fail", title: `Node.js ${process.versions.node} is too old`, fix: "Install Node.js 22.13 or newer" });

    const plugin = contextPilotPlugin(readJson(join(homedir(), ".claude", "plugins", "installed_plugins.json")));
    const which = spawnSync(process.platform === "win32" ? "where" : "which", ["context-pilot"], { encoding: "utf8" });
    const globalBin = which.status === 0 ? which.stdout.trim().split("\n")[0] : null;
    if (globalBin) {
      let real = globalBin;
      try {
        real = realpathSync(globalBin);
      } catch {
        // keep the link path
      }
      let pkg = "context-pilot";
      try {
        pkg = globalPackageName(readlinkSync(globalBin)) ?? pkg;
      } catch {
        // not a link
      }
      const v = spawnSync(globalBin, ["--version"], { encoding: "utf8" });
      const version = v.status === 0 ? v.stdout.trim() : null;
      if (version === null) {
        add({ status: "fail", title: `Global context-pilot at ${globalBin} does not run`, detail: (v.stderr || String(v.error ?? "")).trim().split("\n").pop(), fix: `npm rm -g ${pkg} (or fix ${real})` });
      } else if (isDevLink(real)) {
        add({
          status: "warn",
          title: `Global context-pilot ${version} is a link to a source checkout`,
          detail: `${real} — \`npx context-pilot@${version}\` (plugin hooks, MCP server) runs this build instead of the published package, so a stale or broken build breaks them`,
          fix: `Rebuild it (pnpm build) after every change, or remove the link: npm rm -g ${pkg}`,
        });
      } else {
        add({ status: "ok", title: `Global context-pilot ${version}`, detail: globalBin });
      }
    }

    // ── Agents ───────────────────────────────────────────────────────────────
    if (!root) {
      add({ status: "fail", title: "Not inside a git repository", detail: resolve(projectPath), fix: "Run doctor from your project, or pass its path" });
      return finish(checks);
    }
    console.log(chalk.dim(`\nProject ${root}`));

    if (plugin) {
      const pluginHooks = readJson(join(plugin.installPath, "hooks", "hooks.json"));
      const missing = ["UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop"].filter((e) => !hookCommand(pluginHooks, e));
      add(
        missing.length
          ? { status: "warn", title: `Claude Code plugin ${plugin.version}: hooks missing for ${missing.join(", ")}`, fix: "claude plugin update context-pilot@context-pilot" }
          : { status: "ok", title: `Claude Code plugin ${plugin.version} (${plugin.scope}): prompt, search, edit and stop hooks` }
      );
      if (plugin.version !== CLI_VERSION) {
        add({ status: "warn", title: `Plugin is ${plugin.version}, this CLI is ${CLI_VERSION}`, fix: "claude plugin marketplace update context-pilot && claude plugin update context-pilot@context-pilot" });
      }
    }

    const agents = [...new Set<Agent>([...detectAgents(root), ...AGENTS.filter((a) => hasAgent(root, a))])];
    for (const agent of agents) {
      const installed = hasAgent(root, agent);
      if (agent === "claude" && plugin) {
        if (installed) add({ status: "warn", title: "Claude Code: plugin and project hooks both installed (every hook runs twice)", fix: `context-pilot hook uninstall -p ${root}` });
        continue;
      }
      add(
        installed
          ? { status: "ok", title: `${AGENT_NAMES[agent]}: hooks installed`, detail: hookConfigPath(root, agent) }
          : { status: "warn", title: `${AGENT_NAMES[agent]}: no hooks in this project`, fix: agent === "claude" ? "claude plugin install context-pilot@context-pilot (or context-pilot setup)" : `context-pilot hook install --agent ${agent}` }
      );
    }
    if (agents.length === 0 && !plugin) add({ status: "warn", title: "No coding agent detected", fix: "context-pilot setup" });

    // ── Index ────────────────────────────────────────────────────────────────
    const engine = new ContextEngine();
    try {
      add(indexCheck(await engine.status({ projectPath: root })));
    } finally {
      engine.close();
    }

    // ── Recent trace ─────────────────────────────────────────────────────────
    const recent = filterTrace(readTrace(), { sinceMs: 7 * 86400e3, project: root });
    const errors = recent.filter((r) => r.result === "error");
    if (recent.length === 0) {
      add({ status: "warn", title: "No hook calls recorded here in the last 7 days", detail: "hooks may not be running, or this version doesn't trace yet" });
    } else {
      add({
        status: errors.length ? "warn" : "ok",
        title: `${recent.length} hook calls in the last 7 days, ${errors.length} errors`,
        detail: errors.length ? `last error: ${errors[errors.length - 1].reason ?? "?"}` : undefined,
        fix: errors.length ? "context-pilot trace --since 7d" : undefined,
      });
    }

    if (options.skipRun) return finish(checks);

    // ── Run what the agent runs ──────────────────────────────────────────────
    const env = { ...process.env, CLAUDE_PROJECT_DIR: root };
    const pluginHooks = plugin ? readJson(join(plugin.installPath, "hooks", "hooks.json")) : null;
    const projectHooks = readJson(hookConfigPath(root, "claude"));
    const hookCmd =
      hookCommand(pluginHooks, "UserPromptSubmit") ??
      hookCommand(projectHooks, "UserPromptSubmit") ??
      `${quote(launcherArgv())} on prompt --hook --agent claude`;
    console.log(chalk.dim(`\nRunning the prompt hook: ${hookCmd}`));
    const sample = JSON.stringify({ session_id: DOCTOR_SESSION, cwd: root, hook_event_name: "UserPromptSubmit", prompt: "context-pilot doctor: where does this project start up?" });
    const hook = await run(hookCmd, sample, { cwd: root, env, timeoutMs: HOOK_TIMEOUT_MS });
    add(hookRunCheck("prompt", hook.code, hook.ms, hook.stderr, hook.timedOut));
    const pinned = pinnedVersion(hookCmd);
    if (pinned && pinned !== CLI_VERSION) {
      add({ status: "warn", title: `Hooks run context-pilot ${pinned}`, detail: `this CLI is ${CLI_VERSION}` });
    }

    const mcpConfig = plugin ? (readJson(join(plugin.installPath, ".mcp.json")) as { mcpServers?: Record<string, { command: string; args?: string[] }> } | null) : null;
    const server = mcpConfig?.mcpServers?.["context-pilot"];
    const serveCmd = server
      ? quote([server.command, ...(server.args ?? []).map((a) => a.replace("${CLAUDE_PROJECT_DIR}", root))])
      : `${quote(launcherArgv())} serve ${quote([root])}`;
    console.log(chalk.dim(`Starting the MCP server: ${serveCmd}`));
    const handshake =
      [
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "context-pilot-doctor", version: CLI_VERSION } } },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
      ]
        .map((m) => JSON.stringify(m))
        .join("\n") + "\n";
    const mcp = await run(serveCmd, handshake, {
      cwd: root,
      env,
      timeoutMs: MCP_TIMEOUT_MS,
      keepOpen: true,
      until: (out) => out.includes('"id":2'),
    });
    add(mcpCheck(mcp.stdout, mcp.stderr, mcp.ms, mcp.timedOut));

    finish(checks);
  });

function finish(checks: Check[]): void {
  const fails = checks.filter((c) => c.status === "fail").length;
  const warns = checks.filter((c) => c.status === "warn").length;
  console.log(
    "\n" +
      (fails ? chalk.red(`${fails} problem${fails === 1 ? "" : "s"}`) : chalk.green("No problems")) +
      (warns ? chalk.yellow(`, ${warns} warning${warns === 1 ? "" : "s"}`) : "")
  );
  if (fails) process.exitCode = 1;
}

