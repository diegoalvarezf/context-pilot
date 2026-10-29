import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawnSync } from "child_process";
import { describe, expect, it } from "vitest";
import {
  filterTrace,
  parseSince,
  parseTrace,
  percentile,
  promptHash,
  readTrace,
  summarize,
  toolCallsOf,
  touches,
  usedFiles,
  usefulness,
  writeTrace,
  type TraceRecord,
} from "../src/trace.js";

const rec = (over: Partial<TraceRecord>): TraceRecord => ({
  ts: "2026-10-29T10:00:00.000Z",
  agent: "claude",
  event: "prompt",
  project: "/r",
  session: "s1",
  ms: 10,
  result: "said",
  version: "0.7.0",
  ...over,
});

describe("writing the trace", () => {
  it("appends JSON lines and rotates past the size limit", () => {
    const dir = mkdtempSync(join(tmpdir(), "cp-trace-"));
    const file = join(dir, "trace.jsonl");
    writeTrace(rec({ ms: 1 }), file, 50);
    writeTrace(rec({ ms: 2 }), file, 50);
    expect(existsSync(join(dir, "trace.1.jsonl"))).toBe(true);
    writeTrace(rec({ ms: 3 }), file, 50);
    // one record per file at this size: the oldest is dropped on the second rotation
    expect(readTrace(file).map((r) => r.ms)).toEqual([2, 3]);
  });

  it("never throws when it can't write", () => {
    expect(() => writeTrace(rec({}), "/proc/does/not/exist/trace.jsonl")).not.toThrow();
  });

  it("skips torn lines", () => {
    expect(parseTrace(`${JSON.stringify(rec({ ms: 5 }))}\n{"ts":"x","ev\n\n`)).toHaveLength(1);
  });

  it("hashes prompts instead of storing them", () => {
    expect(promptHash("fix the retry delay")).toMatch(/^[0-9a-f]{12}$/);
    expect(promptHash("a")).not.toBe(promptHash("b"));
  });
});

describe("summarizing", () => {
  it("parses durations", () => {
    expect(parseSince("30m")).toBe(30 * 60e3);
    expect(parseSince("7d")).toBe(7 * 86400e3);
    expect(parseSince("soon")).toBeNull();
  });

  it("filters by age and project", () => {
    const now = Date.parse("2026-10-29T12:00:00Z");
    const rs = [rec({ ts: "2026-10-29T11:30:00Z" }), rec({ ts: "2026-10-27T11:30:00Z" }), rec({ ts: "2026-10-29T11:59:00Z", project: "/other" })];
    expect(filterTrace(rs, { sinceMs: 3600e3, now })).toHaveLength(2);
    expect(filterTrace(rs, { project: "/R" })).toHaveLength(2);
  });

  it("counts results and reasons per event, with latency", () => {
    const s = summarize([
      rec({ ms: 10 }),
      rec({ ms: 30, result: "silent", reason: "low confidence" }),
      rec({ ms: 20, result: "silent", reason: "low confidence" }),
      rec({ event: "edit", ms: 100, result: "error", reason: "boom" }),
    ]);
    expect(s.map((e) => e.event)).toEqual(["prompt", "edit"]);
    expect(s[0]).toMatchObject({ calls: 3, said: 1, silent: 2, meanMs: 20, p95Ms: 30, reasons: { "silent: low confidence": 2 } });
    expect(s[1]).toMatchObject({ error: 1, reasons: { "error: boom": 1 } });
    expect(percentile([1, 2, 3, 4, 100], 95)).toBe(100);
  });
});

const transcript = [
  { type: "user", timestamp: "2026-10-29T09:59:00Z", message: { content: "fix it" } },
  { type: "assistant", timestamp: "2026-10-29T10:00:05Z", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "/r/src/auth.ts" } }] } },
  { type: "assistant", timestamp: "2026-10-29T10:00:09Z", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "sed -n 1,40p test/auth.test.ts" } }] } },
  { type: "assistant", timestamp: "2026-10-29T10:00:20Z", message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: "/r/src/app.ts" } }] } },
]
  .map((l) => JSON.stringify(l))
  .join("\n");

describe("were the suggestions used", () => {
  const calls = toolCallsOf(transcript);

  it("reads tool calls from a Claude Code transcript", () => {
    expect(calls.map((c) => c.name)).toEqual(["Read", "Bash", "Edit"]);
  });

  it("matches reads, edits and shell commands on a suggested file", () => {
    expect(touches(calls[0], "src/auth.ts")).toBe(true);
    expect(touches(calls[1], "test/auth.test.ts")).toBe(true);
    expect(touches(calls[0], "auth.ts")).toBe(true);
    expect(touches(calls[0], "src/app.ts")).toBe(false);
  });

  it("only counts calls after the hook and within the window", () => {
    const r = rec({ files: ["src/auth.ts", "test/auth.test.ts", "src/app.ts", "src/never.ts"] });
    expect(usedFiles(r, calls, 20)).toEqual(["src/auth.ts", "test/auth.test.ts", "src/app.ts"]);
    expect(usedFiles(r, calls, 1)).toEqual(["src/auth.ts"]);
    expect(usedFiles(rec({ ts: "2026-10-29T10:00:10Z", files: ["src/auth.ts"] }), calls)).toEqual([]);
  });

  it("aggregates per event, skipping calls without a transcript", () => {
    const rs = [
      rec({ files: ["src/auth.ts", "src/never.ts"], transcript: "t1" }),
      rec({ event: "edit", files: ["src/never.ts"], transcript: "t1" }),
      rec({ files: ["src/auth.ts"] }),
      rec({ files: ["src/auth.ts"], transcript: "missing" }),
      rec({ result: "silent", files: ["src/auth.ts"], transcript: "t1" }),
    ];
    const u = usefulness(rs, (p) => (p === "t1" ? transcript : null));
    expect(u).toEqual([
      { event: "prompt", calls: 1, suggested: 2, used: 1, callsWithUse: 1 },
      { event: "edit", calls: 1, suggested: 1, used: 0, callsWithUse: 0 },
    ]);
  });
});

describe("`on` writes the trace", () => {
  it("records skipped calls, with no prompt text", () => {
    const home = mkdtempSync(join(tmpdir(), "cp-home-"));
    const cli = join(__dirname, "..", "dist", "index.js");
    const repo = mkdtempSync(join(tmpdir(), "cp-norepo-"));
    const input = JSON.stringify({ session_id: "abc", cwd: repo, prompt: "a secret task description", transcript_path: "/t.jsonl" });
    const r = spawnSync(process.execPath, [cli, "on", "prompt", "--hook", "--agent", "claude"], {
      input,
      env: { ...process.env, CONTEXT_PILOT_HOME: home },
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
    const text = readFileSync(join(home, "trace.jsonl"), "utf8");
    expect(text).not.toContain("secret");
    const [record] = parseTrace(text);
    expect(record).toMatchObject({ event: "prompt", result: "skipped", reason: "not a git repository", session: "abc", transcript: "/t.jsonl" });
    expect(record.prompt).toEqual({ length: 25, hash: promptHash("a secret task description") });
  });

  it("works when the trace can't be written", () => {
    const cli = join(__dirname, "..", "dist", "index.js");
    const blocked = join(mkdtempSync(join(tmpdir(), "cp-blocked-")), "file");
    writeFileSync(blocked, "");
    const r = spawnSync(process.execPath, [cli, "on", "edit", "--hook", "--agent", "claude"], {
      input: "{}",
      env: { ...process.env, CONTEXT_PILOT_HOME: join(blocked, "sub") },
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
  });
});
