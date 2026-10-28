import { Command } from "commander";
import { spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { isAbsolute, join, relative, resolve } from "path";
import chalk from "chalk";
import { ContextEngine, toProjectPath } from "context-pilot-engine";
import {
  editedFile,
  EMPTY_HINT_STATE,
  formatHint,
  hookOutput,
  pickHints,
  recordHint,
  stateFileName,
  type HintState,
} from "../hint.js";

export const DEFAULT_HINT_MIN_SCORE = 0.5;

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function gitRoot(dir: string): string | null {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: dir, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

const stateDir = join(tmpdir(), "context-pilot");

function loadState(sessionId: string): HintState {
  try {
    return JSON.parse(readFileSync(join(stateDir, stateFileName(sessionId)), "utf8")) as HintState;
  } catch {
    return EMPTY_HINT_STATE;
  }
}

function saveState(sessionId: string, state: HintState): void {
  try {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, stateFileName(sessionId)), JSON.stringify(state));
  } catch {
    // a lost state only means a hint may repeat
  }
}

async function hintsFor(root: string, file: string, state: HintState, minScore: number, limit: number) {
  const engine = new ContextEngine();
  try {
    // Incremental and cheap when HEAD has not moved; the first run mines the history
    await engine.mineHistory({ projectPath: root });
    const r = engine.impact({ projectPath: root, files: [file], limit: 15 });
    return pickHints(r.results, state, { minScore, limit });
  } finally {
    engine.close();
  }
}

export const hintCommand = new Command("hint")
  .description("What usually changes together with a file you just edited (Claude Code PostToolUse hook)")
  .argument("[file]", "File you just edited (not needed with --claude-hook)")
  .option("-p, --project <path>", "Project root path (default: the git repo of the file or of the session)")
  .option("--min-score <n>", "Only mention files whose score reaches this (0-1)", String(DEFAULT_HINT_MIN_SCORE))
  .option("-n, --limit <n>", "Max files to mention", "3")
  .option("--claude-hook", "Run as a Claude Code PostToolUse hook (reads hook input on stdin)", false)
  .action(
    async (
      fileArg: string | undefined,
      options: { project?: string; minScore: string; limit: string; claudeHook: boolean }
    ) => {
      const minScore = parseFloat(options.minScore);
      const limit = parseInt(options.limit, 10);

      if (options.claudeHook) {
        // Never get in Claude's way: any problem means "nothing to say"
        try {
          const input = JSON.parse((await readStdin()) || "{}") as {
            session_id?: string;
            cwd?: string;
            tool_input?: Record<string, unknown>;
          };
          const file = editedFile(input);
          if (!file) return;
          const cwd = input.cwd ?? process.cwd();
          const abs = isAbsolute(file) ? file : resolve(cwd, file);
          const root = options.project ? resolve(options.project) : gitRoot(cwd);
          if (!root || relative(root, abs).startsWith("..") || !existsSync(join(root, ".git"))) return;

          const sessionId = input.session_id ?? "default";
          const state = loadState(sessionId);
          const rel = toProjectPath(root, abs);
          const hints = await hintsFor(root, abs, state, minScore, limit);
          saveState(sessionId, recordHint(state, rel, hints));
          if (hints.length > 0) process.stdout.write(hookOutput(formatHint(rel, hints)) + "\n");
        } catch {
          process.exitCode = 0;
        }
        return;
      }

      if (!fileArg) {
        console.error(chalk.red("Pass the file you edited, or use --claude-hook."));
        process.exitCode = 1;
        return;
      }
      const abs = resolve(fileArg);
      const root = options.project ? resolve(options.project) : gitRoot(resolve(abs, ".."));
      if (!root) {
        console.error(chalk.red(`Not inside a git repository: ${abs}`));
        process.exitCode = 1;
        return;
      }
      const hints = await hintsFor(root, abs, EMPTY_HINT_STATE, minScore, limit);
      if (hints.length === 0) console.log(chalk.dim("Nothing usually changes together with this file."));
      else console.log(formatHint(toProjectPath(root, abs), hints));
    }
  );
