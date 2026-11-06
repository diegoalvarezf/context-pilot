import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { spawnSync } from "child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { editedPaths, readTrace, toolCallsOf } from "../src/trace.js";

const cli = join(__dirname, "..", "dist", "index.js");
const temp = (name: string) => (realpathSync.native ? realpathSync.native(mkdtempSync(join(tmpdir(), name))) : realpathSync(mkdtempSync(join(tmpdir(), name))));

let repo: string;
let home: string;
let sessions = 0;

const git = (...args: string[]) =>
  spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo, encoding: "utf8" });

function write(files: string[], content: string): void {
  for (const f of files) {
    mkdirSync(dirname(join(repo, f)), { recursive: true });
    writeFileSync(join(repo, f), content);
  }
}

/** A Claude Code transcript where the agent used these tools on these files. */
function transcript(calls: [tool: string, file: string][]): string {
  const path = join(temp("cp-transcript-"), "t.jsonl");
  const lines = calls.map(([name, file]) =>
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-11-05T10:00:00.000Z",
      message: { content: [{ type: "tool_use", id: "x", name, input: { file_path: join(repo, file) } }] },
    })
  );
  writeFileSync(path, lines.join("\n"));
  return path;
}

function stop(session: string, transcriptPath?: string) {
  const r = spawnSync(process.execPath, [cli, "on", "stop", "--hook", "--agent", "claude"], {
    input: JSON.stringify({ session_id: session, cwd: repo, ...(transcriptPath ? { transcript_path: transcriptPath } : {}) }),
    env: { ...process.env, CONTEXT_PILOT_HOME: home },
    encoding: "utf8",
  });
  expect(r.status).toBe(0);
  const last = readTrace(join(home, "trace.jsonl")).pop()!;
  return { said: r.stdout ? (JSON.parse(r.stdout).reason as string) : null, reason: last.reason };
}

const newSession = () => `stop-test-${process.pid}-${Date.now()}-${sessions++}`;

describe("stop hook", () => {
  beforeAll(() => {
    repo = temp("cp-stop-");
    home = temp("cp-home-");
    git("init", "-q");
    for (let i = 0; i < 3; i++) {
      write(["src/auth.ts", "src/session.ts", "src/cart.ts", "src/price.ts"], `v${i}`);
      git("add", ".");
      git("commit", "-qm", `c${i}`);
    }
    for (let i = 0; i < 3; i++) {
      write(["src/auth.ts", "src/session.ts"], `a${i}`);
      git("add", ".");
      git("commit", "-qm", `auth ${i}`);
      write(["src/cart.ts", "src/price.ts"], `b${i}`);
      git("add", ".");
      git("commit", "-qm", `cart ${i}`);
    }
    write(["src/auth.ts"], "uncommitted");
  }, 60_000);

  it("says each file once per session", () => {
    const t = transcript([["Edit", "src/auth.ts"]]);
    const s = newSession();
    expect(stop(s, t).said).toContain("src/session.ts");
    expect(stop(s, t)).toEqual({ said: null, reason: "already said" });
    // Another session that edited it hears it too
    expect(stop(newSession(), t).said).toContain("src/session.ts");
  }, 60_000);

  it("stays silent about uncommitted changes the session didn't make", () => {
    const readOnly = transcript([["Read", "src/auth.ts"]]);
    expect(stop(newSession(), readOnly)).toEqual({ said: null, reason: "changes aren't from this session" });
  }, 60_000);

  it("only answers for the files the session edited", () => {
    write(["src/cart.ts"], "uncommitted");
    const said = stop(newSession(), transcript([["Write", "src/cart.ts"]])).said;
    git("checkout", "--", "src/cart.ts");
    expect(said).toContain("src/price.ts");
    expect(said).not.toContain("src/session.ts");
  }, 60_000);

  it("looks at the whole change when it can't know what the session edited", () => {
    expect(stop(newSession()).said).toContain("src/session.ts");
    expect(stop(newSession(), join(home, "no-such-transcript.jsonl")).said).toContain("src/session.ts");
  }, 60_000);
});

describe("editedPaths", () => {
  const calls = (...tools: [string, Record<string, unknown>][]) =>
    toolCallsOf(
      JSON.stringify({ timestamp: "2026-11-05T10:00:00.000Z", content: tools.map(([name, input]) => ({ type: "tool_use", name, input })) })
    );

  it("takes tools that change a file, not the ones that read it", () => {
    expect(
      editedPaths(
        calls(
          ["Edit", { file_path: "/r/a.ts" }],
          ["Write", { file_path: "/r/b.ts" }],
          ["NotebookEdit", { notebook_path: "/r/c.ipynb" }],
          ["Read", { file_path: "/r/d.ts" }],
          ["Grep", { pattern: "x", path: "/r/e.ts" }],
          ["Bash", { command: "cat /r/f.ts" }]
        )
      )
    ).toEqual(["/r/a.ts", "/r/b.ts", "/r/c.ipynb"]);
  });

  it("reads Codex patches, also through a shell", () => {
    const patch = "*** Begin Patch\n*** Update File: src/a.ts\n*** Add File: src/b.ts\n*** End Patch";
    expect(editedPaths(calls(["apply_patch", { input: patch }]))).toEqual(["src/a.ts", "src/b.ts"]);
    expect(editedPaths(calls(["shell", { command: patch }]))).toEqual(["src/a.ts", "src/b.ts"]);
  });
});
