import { createHash } from "crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";

// Every hook call leaves one JSON line in ~/.context-pilot/trace.jsonl: whether it
// spoke, stayed silent (and why), failed or was skipped, how long it took and what
// it suggested. `context-pilot trace` reads it back. Never the prompt itself.

export type TraceResult = "said" | "silent" | "error" | "skipped";

export interface TraceRecord {
  ts: string;
  agent: string;
  event: string;
  project: string | null;
  session: string;
  ms: number;
  result: TraceResult;
  /** Why it stayed silent, was skipped or failed */
  reason?: string;
  /** Map confidence, for prompt */
  confidence?: number;
  /** Files suggested to the agent, project-relative */
  files?: string[];
  prompt?: { length: number; hash: string };
  /** The agent's transcript, to check later whether suggestions were used */
  transcript?: string;
  version: string;
}

export const TRACE_MAX_BYTES = 5 * 1024 * 1024;

export function contextPilotHome(): string {
  return process.env.CONTEXT_PILOT_HOME || join(homedir(), ".context-pilot");
}

export function traceFile(): string {
  return join(contextPilotHome(), "trace.jsonl");
}

/** Short, stable hash of a prompt: tells repeated prompts apart without storing them. */
export function promptHash(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex").slice(0, 12);
}

/** Appends a record; rotates to trace.1.jsonl past the size limit. Never throws. */
export function writeTrace(record: TraceRecord, file = traceFile(), maxBytes = TRACE_MAX_BYTES): void {
  try {
    mkdirSync(join(file, ".."), { recursive: true });
    if (existsSync(file) && statSync(file).size >= maxBytes) renameSync(file, file.replace(/\.jsonl$/, ".1.jsonl"));
    appendFileSync(file, JSON.stringify(record) + "\n");
  } catch {
    // tracing must never change what the hook does
  }
}

export function parseTrace(text: string): TraceRecord[] {
  const out: TraceRecord[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as TraceRecord;
      if (r && typeof r.ts === "string" && typeof r.event === "string") out.push(r);
    } catch {
      // a torn line (two hooks writing at once) is skipped
    }
  }
  return out;
}

/** Current and rotated trace, oldest first. */
export function readTrace(file = traceFile()): TraceRecord[] {
  const read = (f: string) => (existsSync(f) ? readFileSync(f, "utf8") : "");
  return parseTrace(read(file.replace(/\.jsonl$/, ".1.jsonl")) + read(file));
}

/** "7d", "24h", "30m" → milliseconds; null when not understood. */
export function parseSince(s: string): number | null {
  const m = /^(\d+(?:\.\d+)?)\s*([smhdw])$/.exec(s.trim());
  if (!m) return null;
  const unit = { s: 1e3, m: 60e3, h: 3600e3, d: 86400e3, w: 604800e3 }[m[2] as "s" | "m" | "h" | "d" | "w"];
  return Number(m[1]) * unit;
}

export function filterTrace(
  records: TraceRecord[],
  opts: { sinceMs?: number | null; project?: string | null; now?: number }
): TraceRecord[] {
  const now = opts.now ?? Date.now();
  return records.filter(
    (r) =>
      (!opts.sinceMs || now - Date.parse(r.ts) <= opts.sinceMs) &&
      (!opts.project || (r.project ?? "").toLowerCase() === opts.project.toLowerCase())
  );
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

export interface EventSummary {
  event: string;
  calls: number;
  said: number;
  silent: number;
  error: number;
  skipped: number;
  /** reason → count, for silent / error / skipped */
  reasons: Record<string, number>;
  meanMs: number;
  p95Ms: number;
}

export function summarize(records: TraceRecord[]): EventSummary[] {
  const by = new Map<string, TraceRecord[]>();
  for (const r of records) by.set(r.event, [...(by.get(r.event) ?? []), r]);
  const order = ["prompt", "search", "edit", "stop"];
  return [...by.entries()]
    .sort(([a], [b]) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))
    .map(([event, rs]) => {
      const reasons: Record<string, number> = {};
      for (const r of rs) if (r.result !== "said" && r.reason) reasons[`${r.result}: ${r.reason}`] = (reasons[`${r.result}: ${r.reason}`] ?? 0) + 1;
      const ms = rs.map((r) => r.ms);
      const count = (k: TraceResult) => rs.filter((r) => r.result === k).length;
      return {
        event,
        calls: rs.length,
        said: count("said"),
        silent: count("silent"),
        error: count("error"),
        skipped: count("skipped"),
        reasons,
        meanMs: Math.round(ms.reduce((a, b) => a + b, 0) / (ms.length || 1)),
        p95Ms: percentile(ms, 95),
      };
    });
}

// ── Were the suggestions used? ───────────────────────────────────────────────

/** Tool calls the agent made after a hook spoke, in transcript order. */
export interface ToolCall {
  ts: number;
  name: string;
  input: Record<string, unknown>;
}

const PATH_KEYS = ["file_path", "notebook_path", "path", "target_file", "filePath", "filename", "absolute_path"];
/** Tools that read or change a file: touching a suggested file through them counts as using it */
const FILE_TOOLS = /^(read|view|edit|multiedit|write|notebookedit|str_replace|apply_patch|read_file|write_file|replace|create|open)/i;

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Tool calls in a transcript (Claude Code JSONL, or any JSONL with name + input objects). */
export function toolCallsOf(transcript: string): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const line of transcript.split("\n")) {
    if (!line.trim()) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isObject(entry)) continue;
    const ts = Date.parse(String(entry.timestamp ?? ""));
    const visit = (v: unknown, depth: number): void => {
      if (depth > 6) return;
      if (Array.isArray(v)) return v.forEach((x) => visit(x, depth + 1));
      if (!isObject(v)) return;
      if ((v.type === "tool_use" || v.type === "function_call" || "input" in v || "arguments" in v) && typeof v.name === "string") {
        let input = v.input ?? v.arguments;
        if (typeof input === "string") {
          try {
            input = JSON.parse(input);
          } catch {
            input = { command: input };
          }
        }
        if (isObject(input)) calls.push({ ts: Number.isNaN(ts) ? 0 : ts, name: v.name, input });
        return;
      }
      for (const x of Object.values(v)) visit(x, depth + 1);
    };
    visit(entry, 0);
  }
  return calls;
}

/** Does this tool call open, change or explicitly target `file` (project-relative)? */
export function touches(call: ToolCall, file: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, "/");
  const target = norm(file);
  const matches = (p: string) => {
    const n = norm(p);
    return n === target || n.endsWith(`/${target}`);
  };
  if (FILE_TOOLS.test(call.name)) {
    for (const k of PATH_KEYS) {
      const v = call.input[k];
      if (typeof v === "string" && matches(v)) return true;
    }
    const patch = call.input.patch ?? call.input.input;
    if (typeof patch === "string" && patch.includes(target)) return true;
  }
  // Shell (cat, sed -n, grep in the file) or search scoped to it
  const cmd = call.input.command ?? call.input.cmd;
  if (typeof cmd === "string" && cmd.includes(target)) return true;
  const scope = call.input.path ?? call.input.glob;
  return typeof scope === "string" && scope !== "." && matches(scope);
}

export const FOLLOW_WINDOW = 20;

/** Which suggested files the agent opened or changed within its next `window` tool calls. */
export function usedFiles(record: TraceRecord, calls: ToolCall[], window = FOLLOW_WINDOW): string[] {
  const after = Date.parse(record.ts);
  const next = calls.filter((c) => c.ts >= after).slice(0, window);
  return (record.files ?? []).filter((f) => next.some((c) => touches(c, f)));
}

export interface Usefulness {
  event: string;
  /** Calls that suggested files and whose transcript could be read */
  calls: number;
  suggested: number;
  used: number;
  /** Calls where at least one suggestion was used */
  callsWithUse: number;
}

export function usefulness(
  records: TraceRecord[],
  transcriptOf: (path: string) => string | null,
  window = FOLLOW_WINDOW
): Usefulness[] {
  const cache = new Map<string, ToolCall[] | null>();
  const callsFor = (path: string) => {
    if (!cache.has(path)) {
      const text = transcriptOf(path);
      cache.set(path, text === null ? null : toolCallsOf(text));
    }
    return cache.get(path)!;
  };
  const by = new Map<string, Usefulness>();
  for (const r of records) {
    if (r.result !== "said" || !r.files?.length || !r.transcript) continue;
    const calls = callsFor(r.transcript);
    if (!calls) continue;
    const used = usedFiles(r, calls, window);
    const u = by.get(r.event) ?? { event: r.event, calls: 0, suggested: 0, used: 0, callsWithUse: 0 };
    u.calls++;
    u.suggested += r.files.length;
    u.used += used.length;
    if (used.length) u.callsWithUse++;
    by.set(r.event, u);
  }
  return [...by.values()];
}
