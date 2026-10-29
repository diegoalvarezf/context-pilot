import { Command } from "commander";
import { spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { isAbsolute, join, relative, resolve } from "path";
import {
  ContextEngine,
  DEFAULT_CHECK_MIN_SCORE,
  formatFindSymbol,
  toProjectPath,
} from "context-pilot-engine";
import { AGENTS, editedFiles, formatReply, HOOK_EVENTS, parseHookInput, searchedName, type Agent, type HookEvent, type HookInput } from "../agents.js";
import { HOOK_FLAG } from "../agent-config.js";
import { EMPTY_HINT_STATE, formatHint, pickHints, recordHint, stateFileName, type HintState } from "../hint.js";
import { DEFAULT_HINT_MIN_SCORE } from "./hint.js";

// The single hook entry point for every agent: `context-pilot on <event> --hook --agent <a>`.
// It never gets in the agent's way: anything unexpected means "nothing to say".

/** Below this the task probably isn't about code we can find: say nothing (see `bench`) */
export const PROMPT_MIN_CONFIDENCE = 0.3;
const PROMPT_BUDGET = 800;
const MIN_PROMPT_CHARS = 12;
/** Hooks re-index at most this often; the index answers from what it has in between */
const HOOK_FRESH_MS = 30 * 60_000;

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

// Per agent session: what we already said, so nothing is repeated
interface SessionState extends HintState {
  searched: string[];
}
const stateDir = join(tmpdir(), "context-pilot");
function loadState(sessionId: string): SessionState {
  try {
    const s = JSON.parse(readFileSync(join(stateDir, stateFileName(sessionId)), "utf8")) as Partial<SessionState>;
    return { ...EMPTY_HINT_STATE, searched: [], ...s };
  } catch {
    return { ...EMPTY_HINT_STATE, searched: [] };
  }
}
function saveState(sessionId: string, state: SessionState): void {
  try {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, stateFileName(sessionId)), JSON.stringify(state));
  } catch {
    // a lost state only means something may be said twice
  }
}

/** What to tell the agent for this event, or null. */
export async function respond(event: HookEvent, input: HookInput, root: string): Promise<string | null> {
  const engine = new ContextEngine();
  try {
    if (event === "stop") {
      if (input.stopActive) return null;
      await engine.mineHistory({ projectPath: root });
      const r = await engine.checkChange({ projectPath: root, minScore: DEFAULT_CHECK_MIN_SCORE, limit: 5 });
      if (r.missing.length === 0) return null;
      return (
        "context-pilot: these files usually change together with the ones you edited but are untouched. " +
        "Check whether any needs updating; if none does, say so and stop.\n" +
        r.missing.map((m) => `- ${m.path}: ${m.reasons[0] ?? ""}`).join("\n")
      );
    }

    await engine.ensureFresh({ projectPath: root, maxAgeMs: HOOK_FRESH_MS });
    const state = loadState(input.sessionId);

    if (event === "prompt") {
      const task = input.prompt?.trim() ?? "";
      if (task.length < MIN_PROMPT_CHARS) return null;
      const map = engine.pilot({ projectPath: root, task, budget: PROMPT_BUDGET });
      if (map.files.length === 0 || map.confidence < PROMPT_MIN_CONFIDENCE) return null;
      saveState(input.sessionId, { ...state, hinted: [...new Set([...state.hinted, ...map.files.map((f) => f.path)])] });
      return `${map.text}\n(context-pilot: from the code index and git history. Tools: pilot, find_symbol, outline.)`;
    }

    if (event === "search") {
      const name = searchedName(input);
      if (!name || state.searched.includes(name)) return null;
      const found = engine.findSymbol({ projectPath: root, name, limit: 10 });
      if (found.definitions.length === 0) return null;
      saveState(input.sessionId, { ...state, searched: [...state.searched, name] });
      return `context-pilot already knows where this is:\n${formatFindSymbol(found)}`;
    }

    // edit
    const cwd = input.cwd ?? root;
    for (const file of editedFiles(input)) {
      const abs = isAbsolute(file) ? file : resolve(cwd, file);
      if (relative(root, abs).startsWith("..")) continue;
      const rel = toProjectPath(root, abs);
      await engine.mineHistory({ projectPath: root });
      const impact = engine.impact({ projectPath: root, files: [abs], limit: 15 });
      const hints = pickHints(impact.results, state, { minScore: DEFAULT_HINT_MIN_SCORE, limit: 3 });
      saveState(input.sessionId, { ...state, ...recordHint(state, rel, hints) });
      if (hints.length) return formatHint(rel, hints);
    }
    return null;
  } finally {
    engine.close();
  }
}

export const onCommand = new Command("on")
  .description("Hook entry point for coding agents (reads the agent's hook input on stdin)")
  .argument("<event>", `One of: ${HOOK_EVENTS.join(", ")}`)
  .option("--agent <agent>", `One of: ${AGENTS.join(", ")}`, "claude")
  .option("-p, --project <path>", "Project root path (default: the git repo of the session)")
  .option(HOOK_FLAG, "Marks the hooks context-pilot installed", false)
  .action(async (event: string, options: { agent: string; project?: string }) => {
    try {
      if (!HOOK_EVENTS.includes(event as HookEvent) || !AGENTS.includes(options.agent as Agent)) return;
      const input = parseHookInput(await readStdin());
      const root = options.project ? resolve(options.project) : gitRoot(input.cwd ?? process.cwd());
      if (!root || !existsSync(join(root, ".git"))) return;
      const text = await respond(event as HookEvent, input, root);
      if (!text) return;
      const reply = formatReply(options.agent as Agent, event as HookEvent, text);
      if (reply.stdout) process.stdout.write(reply.stdout + "\n");
      if (reply.stderr) process.stderr.write(reply.stderr + "\n");
      process.exitCode = reply.exitCode;
    } catch {
      process.exitCode = 0;
    }
  });
