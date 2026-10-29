import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import Parser from "web-tree-sitter";
import { ContextEngine } from "../src/engine.js";
import { extractSymbols, signatureOf } from "../src/symbols/extract.js";
import { identifiers, searchFiles, terms } from "../src/pilot/search.js";
import { loadLanguage } from "../src/indexer/languages.js";

let repo: string;
let dbDir: string;
let engine: ContextEngine;
let clock = 1_700_000_000;

function git(...args: string[]): string {
  const date = `${clock} +0000`;
  return execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], {
    cwd: repo,
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    encoding: "utf8",
  });
}

function write(path: string, content: string): void {
  const abs = join(repo, path);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

function commit(message: string): void {
  git("add", "-A");
  git("commit", "-q", "-m", message);
  clock += 3600;
}

async function parse(lang: "typescript" | "python", source: string) {
  const language = await loadLanguage(lang); // initialises tree-sitter
  const parser = new Parser();
  parser.setLanguage(language);
  return parser.parse(source);
}

const HTTP = `import { sleep } from "./time.js";

export interface RetryOptions {
  retries: number;
}

export async function fetchWithRetry(url: string, opts: RetryOptions): Promise<Response> {
  for (let i = 0; i < opts.retries; i++) {
    try {
      return await fetch(url);
    } catch {
      await sleep(backoffDelay(i));
    }
  }
  throw new Error("failed");
}

export const backoffDelay = (attempt: number) => 100 * 2 ** attempt;

export class Client {
  get(path: string) {
    return fetchWithRetry(path, { retries: 3 });
  }
}
`;

describe("extractSymbols", () => {
  it("finds functions, arrow functions, classes, methods and exports in TypeScript", async () => {
    const { symbols, refs } = extractSymbols("typescript", await parse("typescript", HTTP));
    const byName = new Map(symbols.map((s) => [s.name, s]));
    expect(byName.get("fetchWithRetry")).toMatchObject({ kind: "function", exported: true, startLine: 7, endLine: 16 });
    expect(byName.get("fetchWithRetry")!.signature).toBe(
      "export async function fetchWithRetry(url: string, opts: RetryOptions): Promise<Response>"
    );
    expect(byName.get("backoffDelay")).toMatchObject({ kind: "function", exported: true });
    expect(byName.get("RetryOptions")).toMatchObject({ kind: "interface" });
    expect(byName.get("Client")).toMatchObject({ kind: "class" });
    expect(byName.get("get")).toMatchObject({ kind: "method", parent: "Client" });
    // Uses, not definitions
    expect(refs.filter((r) => r.name === "fetchWithRetry").map((r) => r.line)).toEqual([22]);
    expect(refs.some((r) => r.name === "backoffDelay" && r.line === 12)).toBe(true);
  });

  it("marks methods and private names in Python", async () => {
    const src = "class Repo:\n    def save(self, item):\n        return _store(item)\n\ndef _store(x):\n    return x\n";
    const { symbols } = extractSymbols("python", await parse("python", src));
    expect(symbols.map((s) => [s.name, s.kind, s.parent, s.exported])).toEqual([
      ["Repo", "class", null, true],
      ["save", "method", "Repo", true],
      ["_store", "function", null, false],
    ]);
  });

  it("keeps signatures to one line", () => {
    expect(signatureOf("function a(x) {\n  return x;\n}")).toBe("function a(x)");
    expect(signatureOf("def a(x):\n    pass")).toBe("def a(x)");
  });
});

describe("search", () => {
  it("splits identifiers and drops stopwords", () => {
    expect(terms("Fix the fetchWithRetry backoff_delay in HTTPClient")).toEqual([
      "fetch",
      "retry",
      "backoff",
      "delay",
      "http",
      "client",
    ]);
    expect(identifiers("arregla `client.get` y fetchWithRetry")).toEqual(expect.arrayContaining(["get", "fetchWithRetry"]));
  });

  it("ranks the file that defines what the task talks about first", () => {
    const symbols = [
      { path: "src/http.ts", name: "fetchWithRetry", kind: "function", startLine: 7 },
      { path: "src/http.ts", name: "backoffDelay", kind: "function", startLine: 18 },
      { path: "src/user.ts", name: "fetchUser", kind: "function", startLine: 1 },
    ];
    const hits = searchFiles("the retry backoff is too slow", symbols, ["src/http.ts", "src/user.ts", "README.md"]);
    expect(hits[0]).toMatchObject({ path: "src/http.ts", score: 1 });
    expect(hits[0].symbols).toEqual(expect.arrayContaining(["backoffDelay", "fetchWithRetry"]));
    expect(hits.find((h) => h.path === "src/user.ts")).toBeUndefined();
  });
});

describe("pilot, outline and findSymbol", () => {
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "cp-pilot-"));
    dbDir = mkdtempSync(join(tmpdir(), "cp-db-"));
    git("init", "-q");
    engine = new ContextEngine(join(dbDir, "db.sqlite"));

    write("src/time.ts", "export function sleep(ms: number) {\n  return new Promise((r) => setTimeout(r, ms));\n}\n");
    write("src/http.ts", HTTP);
    write("test/http.test.ts", 'import { fetchWithRetry } from "../src/http.js";\nfetchWithRetry("x", { retries: 1 });\n');
    write("src/user.ts", 'import { Client } from "./http.js";\nexport function loadUser(id: string) {\n  return new Client().get(`/users/${id}`);\n}\n');
    commit("http client");
    write("src/http.ts", HTTP + "\n// tweak\n");
    write("test/http.test.ts", 'import { fetchWithRetry } from "../src/http.js";\nfetchWithRetry("y", { retries: 2 });\n');
    commit("tune retries");
  });

  afterEach(() => {
    engine.close();
    rmSync(repo, { recursive: true, force: true });
    rmSync(dbDir, { recursive: true, force: true });
  });

  it("outlines a file and finds a symbol's definition and uses", async () => {
    await engine.index({ projectPath: repo });
    const outline = engine.outline({ projectPath: repo, file: "src/http.ts" });
    expect(outline.symbols.map((s) => s.name)).toEqual(["RetryOptions", "fetchWithRetry", "backoffDelay", "Client", "get"]);
    expect(outline.fileTokens).toBeGreaterThan(50);

    const found = engine.findSymbol({ projectPath: repo, name: "fetchWithRetry" });
    expect(found.definitions).toHaveLength(1);
    expect(found.definitions[0]).toMatchObject({ path: "src/http.ts", startLine: 7, exported: true });
    expect(found.uses.map((u) => u.path).sort()).toEqual(["src/http.ts", "test/http.test.ts"]);
  });

  it("re-indexes a changed file without leaving stale symbols", async () => {
    await engine.index({ projectPath: repo });
    write("src/time.ts", "export function wait(ms: number) {\n  return ms;\n}\n");
    await engine.index({ projectPath: repo });
    expect(engine.outline({ projectPath: repo, file: "src/time.ts" }).symbols.map((s) => s.name)).toEqual(["wait"]);
    expect(engine.findSymbol({ projectPath: repo, name: "sleep" }).definitions).toEqual([]);
  });

  it("maps a task to the right file, its code, related files and tests, within budget", async () => {
    await engine.index({ projectPath: repo });
    const map = engine.pilot({ projectPath: repo, task: "make the retry backoff in fetchWithRetry slower" });
    expect(map.files[0].path).toBe("src/http.ts");
    expect(map.tests).toContain("test/http.test.ts");
    expect(map.text).toContain("L7-16");
    expect(map.text).toContain("export async function fetchWithRetry");
    expect(map.confidence).toBe(1);
    expect(map.tokens).toBeLessThanOrEqual(1500);

    const small = engine.pilot({ projectPath: repo, task: "fetchWithRetry", budget: 60 });
    expect(small.tokens).toBeLessThanOrEqual(80);
  });

  it("is not confident about a task that names no code", async () => {
    await engine.index({ projectPath: repo });
    const map = engine.pilot({ projectPath: repo, task: "what's the licence of this project?" });
    expect(map.confidence).toBeLessThan(0.5);
  });
});
