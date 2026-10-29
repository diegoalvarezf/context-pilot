import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawn, spawnSync } from "child_process";
import { describe, expect, it } from "vitest";

describe("serve", () => {
  it("answers an MCP handshake without writing anything in the project", async () => {
    const repo = mkdtempSync(join(tmpdir(), "cp-serve-"));
    spawnSync("git", ["init", "-q"], { cwd: repo });
    writeFileSync(join(repo, ".gitignore"), "node_modules\n");
    writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
    const before = readdirSync(repo).sort();

    const cli = join(__dirname, "..", "dist", "index.js");
    const child = spawn(process.execPath, [cli, "serve", repo], {
      env: { ...process.env, CONTEXT_PILOT_HOME: mkdtempSync(join(tmpdir(), "cp-home-")) },
    });
    let out = "";
    const answered = new Promise<void>((done, fail) => {
      const timer = setTimeout(() => fail(new Error(`no answer: ${out}`)), 20_000);
      child.stdout.on("data", (d) => {
        out += d;
        if (out.includes('"id":1')) {
          clearTimeout(timer);
          done();
        }
      });
    });
    child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } }) + "\n"
    );
    await answered;
    child.kill();

    expect(readdirSync(repo).sort()).toEqual(before);
    expect(readFileSync(join(repo, ".gitignore"), "utf8")).toBe("node_modules\n");
  }, 30_000);
});
