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
import { promptHash, writeTrace, type TraceRecord, type TraceResult } from "../trace.js";
import { CLI_VERSION } from "../version.js";

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

/** What the hook decided: the text for the agent (or null) and why, for the trace. */
export interface Outcome {
  text: string | null;
  reason?: string;
  confidence?: number;
  files?: string[];
}

const silent = (reason: string, extra: Omit<Outcome, "text" | "reason"> = {}): Outcome => ({ text: null, reason, ...extra });

/** What to tell the agent for this event, and why it says it or not. */
export async function respond(event: HookEvent, input: HookInput, root: string): Promise<Outcome> {
  const engine = new ContextEngine();
  try {
    if (event === "stop") {
      if (input.stopActive) return silent("stop hook already active");
      await engine.mineHistory({ projectPath: root });
      const r = await engine.checkChange({ projectPath: root, minScore: DEFAULT_CHECK_MIN_SCORE, limit: 5 });
      if (r.skipped) return silent(r.skipped);
      if (r.changed.length === 0) return silent("no uncommitted changes");
      if (r.missing.length === 0) return silent("nothing looks missing");
      return {
        text:
          "context-pilot: these files usually change together with the ones you edited but are untouched. " +
          "Check whether any needs updating; if none does, say so and stop.\n" +
          r.missing.map((m) => `- ${m.path}: ${m.reasons[0] ?? ""}`).join("\n"),
        files: r.missing.map((m) => m.path),
      };
    }

    await engine.ensureFresh({ projectPath: root, maxAgeMs: HOOK_FRESH_MS });
    const state = loadState(input.sessionId);

    if (event === "prompt") {
      const task = input.prompt?.trim() ?? "";
      if (task.length < MIN_PROMPT_CHARS) return silent("prompt too short");
      const map = engine.pilot({ projectPath: root, task, budget: PROMPT_BUDGET });
      if (map.files.length === 0) return silent("no matching code", { confidence: map.confidence });
      if (map.confidence < PROMPT_MIN_CONFIDENCE) {
        return silent("low confidence", { confidence: map.confidence, files: map.files.map((f) => f.path) });
      }
      saveState(input.sessionId, { ...state, hinted: [...new Set([...state.hinted, ...map.files.map((f) => f.path)])] });
      return {
        text: `${map.text}\n(context-pilot: from the code index and git history. Tools: pilot, find_symbol, outline.)`,
        confidence: map.confidence,
        files: map.files.map((f) => f.path),
      };
    }

    if (event === "search") {
      const name = searchedName(input);
      if (!name) return silent("not a symbol search");
      if (state.searched.includes(name)) return silent("already said");
      const found = engine.findSymbol({ projectPath: root, name, limit: 10 });
      if (found.definitions.length === 0) return silent("symbol not in the index");
      saveState(input.sessionId, { ...state, searched: [...state.searched, name] });
      return {
        text: `context-pilot already knows where this is:\n${formatFindSymbol(found)}`,
        files: [...new Set(found.definitions.map((d) => d.path))],
      };
    }

    // edit
    const cwd = input.cwd ?? root;
    const files = editedFiles(input);
    if (files.length === 0) return silent("no edited file in the tool call");
    let reason = "edited file outside the project";
    for (const file of files) {
      const abs = isAbsolute(file) ? file : resolve(cwd, file);
      if (relative(root, abs).startsWith("..")) continue;
      const rel = toProjectPath(root, abs);
      await engine.mineHistory({ projectPath: root });
      const impact = engine.impact({ projectPath: root, files: [abs], limit: 15 });
      const hints = pickHints(impact.results, state, { minScore: DEFAULT_HINT_MIN_SCORE, limit: 3 });
      saveState(input.sessionId, { ...state, ...recordHint(state, rel, hints) });
      if (hints.length) return { text: formatHint(rel, hints), files: hints.map((h) => h.path) };
      reason = impact.results.length === 0 ? "no history for this file" : "nothing new above the threshold";
    }
    return silent(reason);
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
    const started = Date.now();
    let input: HookInput | null = null;
    let root: string | null = null;
    let result: TraceResult = "skipped";
    let outcome: Outcome = { text: null };
    try {
      if (!HOOK_EVENTS.includes(event as HookEvent)) outcome = silent("unknown event");
      else if (!AGENTS.includes(options.agent as Agent)) outcome = silent("unknown agent");
      else {
        input = parseHookInput(await readStdin());
        root = options.project ? resolve(options.project) : gitRoot(input.cwd ?? process.cwd());
        if (!root || !existsSync(join(root, ".git"))) outcome = silent("not a git repository");
        else {
          outcome = await respond(event as HookEvent, input, root);
          result = outcome.text ? "said" : "silent";
          if (outcome.text) {
            const reply = formatReply(options.agent as Agent, event as HookEvent, outcome.text);
            if (reply.stdout) process.stdout.write(reply.stdout + "\n");
            if (reply.stderr) process.stderr.write(reply.stderr + "\n");
            process.exitCode = reply.exitCode;
          }
        }
      }
    } catch (err) {
      result = "error";
      outcome = silent(String(err instanceof Error ? err.message : err).slice(0, 200));
      process.exitCode = 0;
    }
    const prompt = event === "prompt" ? input?.prompt?.trim() : undefined;
    const record: TraceRecord = {
      ts: new Date(started).toISOString(),
      agent: options.agent,
      event,
      project: root,
      session: input?.sessionId ?? "default",
      ms: Date.now() - started,
      result,
      ...(outcome.reason && result !== "said" ? { reason: outcome.reason } : {}),
      ...(outcome.confidence !== undefined ? { confidence: Math.round(outcome.confidence * 100) / 100 } : {}),
      ...(outcome.files?.length ? { files: outcome.files } : {}),
      ...(prompt ? { prompt: { length: prompt.length, hash: promptHash(prompt) } } : {}),
      ...(input?.transcriptPath ? { transcript: input.transcriptPath } : {}),
      version: CLI_VERSION,
    };
    writeTrace(record);
  });
