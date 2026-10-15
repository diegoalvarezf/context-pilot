import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { ImportResolver } from "../src/indexer/imports.js";
import { scanImportGraph } from "../src/indexer/indexer.js";

describe("ImportResolver", () => {
  const r = new ImportResolver([
    "index.js",
    "src/a.ts",
    "src/b.ts",
    "src/lib/index.ts",
    "src/comp.tsx",
    "web/app.js",
    "pkg/__init__.py",
    "pkg/models.py",
    "pkg/sub/util.py",
    "src/app/main.py",
    "src/app/services.py",
    "app/Models/User.php",
    "lib/db.php",
    "public/index.php",
  ]);

  it("resolves TS/JS relative imports, including emitted .js extensions and index files", () => {
    expect(r.resolve({ to: "./b.js" }, "src/a.ts", "typescript")).toEqual(["src/b.ts"]);
    expect(r.resolve({ to: "./b" }, "src/a.ts", "typescript")).toEqual(["src/b.ts"]);
    expect(r.resolve({ to: "./lib" }, "src/a.ts", "typescript")).toEqual(["src/lib/index.ts"]);
    expect(r.resolve({ to: "./comp.jsx" }, "src/a.ts", "tsx")).toEqual(["src/comp.tsx"]);
    expect(r.resolve({ to: "../web/app.js" }, "src/a.ts", "javascript")).toEqual(["web/app.js"]);
    expect(r.resolve({ to: "react" }, "src/a.ts", "typescript")).toEqual([]);
    expect(r.resolve({ to: ".." }, "test/app.js", "javascript")).toEqual(["index.js"]);
    expect(r.resolve({ to: "../" }, "test/app.js", "javascript")).toEqual(["index.js"]);
    expect(r.resolve({ to: "../../outside" }, "src/a.ts", "typescript")).toEqual([]);
  });

  it("resolves Python relative and absolute imports", () => {
    expect(r.resolve({ to: ".models", names: ["User"] }, "pkg/__init__.py", "python")).toEqual(["pkg/models.py"]);
    expect(r.resolve({ to: ".", names: ["models"] }, "pkg/__init__.py", "python")).toEqual(["pkg/models.py"]);
    expect(r.resolve({ to: "..models", names: ["x"] }, "pkg/sub/util.py", "python")).toEqual(["pkg/models.py"]);
    expect(r.resolve({ to: "pkg.sub.util" }, "src/app/main.py", "python")).toEqual(["pkg/sub/util.py"]);
    expect(r.resolve({ to: "pkg", names: ["models"] }, "src/app/main.py", "python").sort()).toEqual([
      "pkg/__init__.py",
      "pkg/models.py",
    ]);
    // src layout: `from app import services` from inside src/
    expect(r.resolve({ to: "app", names: ["services"] }, "src/app/main.py", "python")).toEqual(["src/app/services.py"]);
    expect(r.resolve({ to: "os" }, "pkg/models.py", "python")).toEqual([]);
  });

  it("resolves PHP includes and namespaces", () => {
    expect(r.resolve({ to: "'../lib/db.php'" }, "public/index.php", "php")).toEqual(["lib/db.php"]);
    expect(r.resolve({ to: "__DIR__ . '/../lib/db.php'" }, "public/index.php", "php")).toEqual(["lib/db.php"]);
    expect(r.resolve({ to: "App\\Models\\User" }, "public/index.php", "php")).toEqual(["app/Models/User.php"]);
    expect(r.resolve({ to: "Vendor\\Thing" }, "public/index.php", "php")).toEqual([]);
  });
});

describe("scanImportGraph", () => {
  let dir: string;

  const write = (path: string, content: string): void => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cp-imports-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("extracts imports, re-exports, require and dynamic import from real sources", async () => {
    write("src/a.ts", 'import { b } from "./b.js";\nexport * from "./c.js";\nconst d = await import("./d.js");\n');
    write("src/b.ts", "export const b = 1;\n");
    write("src/c.ts", "export const c = 1;\n");
    write("src/d.ts", "export const d = 1;\n");
    write("src/e.js", 'const b = require("./b");\n');
    write("pkg/__init__.py", "from .models import User\n");
    write("pkg/models.py", "import os\nclass User: pass\n");

    const { edges } = await scanImportGraph(dir);
    const set = new Set(edges.map((e) => `${e.from} -> ${e.to}`));

    expect(set).toEqual(
      new Set([
        "src/a.ts -> src/b.ts",
        "src/a.ts -> src/c.ts",
        "src/a.ts -> src/d.ts",
        "src/e.js -> src/b.ts",
        "pkg/__init__.py -> pkg/models.py",
      ])
    );
  });
});

describe("projectId", () => {
  it("maps different spellings of the same folder to one id", async () => {
    const { projectId } = await import("../src/indexer/indexer.js");
    const dir = mkdtempSync(join(tmpdir(), "cp-pid-"));
    try {
      const forward = dir.split("\\").join("/");
      expect(projectId(forward)).toBe(projectId(dir));
      expect(projectId(dir + "/")).toBe(projectId(dir));
      if (process.platform === "win32") expect(projectId(dir.toUpperCase())).toBe(projectId(dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
