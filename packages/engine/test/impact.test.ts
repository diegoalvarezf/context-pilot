import { describe, expect, it } from "vitest";
import { computeImpact, IMPACT_WEIGHTS, isTestFile, testStem } from "../src/impact/impact.js";
import type { CoChangeResult } from "../src/history/cochange.js";

const cochange = (path: string, via: string, confidence: number, support = 3, sourceCommits = 5): CoChangeResult => ({
  path,
  score: confidence,
  support,
  lastChangedTogether: 0,
  sources: [{ file: via, support, confidence, sourceCommits }],
});

describe("test detection", () => {
  it("recognises common test file conventions", () => {
    for (const p of ["test/auth.test.ts", "src/auth.spec.js", "tests/test_auth.py", "auth_test.go", "tests/AuthTest.php", "__tests__/x.ts"]) {
      expect(isTestFile(p)).toBe(true);
    }
    for (const p of ["src/auth.ts", "src/testing.ts", "src/contest.py", "src/Test.php"]) {
      expect(isTestFile(p)).toBe(false);
    }
  });

  it("derives a shared stem for sources and their tests", () => {
    expect(testStem("src/auth.ts")).toBe("auth");
    expect(testStem("test/auth.test.ts")).toBe("auth");
    expect(testStem("tests/test_auth.py")).toBe("auth");
    expect(testStem("tests/AuthTest.php")).toBe("auth");
    expect(testStem("pkg/auth_test.go")).toBe("auth");
  });
});

describe("computeImpact", () => {
  const imports = [
    { from: "src/routes.ts", to: "src/auth.ts" },
    { from: "src/app.ts", to: "src/routes.ts" },
    { from: "src/server.ts", to: "src/app.ts" },
    { from: "src/auth.ts", to: "src/crypto.ts" },
    { from: "test/routes.test.ts", to: "src/auth.ts" },
  ];
  const files = ["src/auth.ts", "src/routes.ts", "src/app.ts", "src/server.ts", "src/crypto.ts", "test/auth.test.ts", "test/routes.test.ts"];

  it("combines dependents, dependencies, tests and co-changes with reasons", () => {
    const results = computeImpact({
      changed: ["src/auth.ts"],
      coChanges: [cochange("src/routes.ts", "src/auth.ts", 0.6), cochange("docs/auth.md", "src/auth.ts", 0.3)],
      imports,
      files,
    });
    const byPath = new Map(results.map((r) => [r.path, r]));

    // Direct dependent + co-change: noisy-OR of both
    const routes = byPath.get("src/routes.ts")!;
    expect(routes.score).toBeCloseTo(1 - (1 - 0.6) * (1 - IMPACT_WEIGHTS.dependent));
    expect(routes.reasons).toEqual([
      "changed together with src/auth.ts in 3 of 5 commits",
      "imports src/auth.ts",
    ]);
    expect(results[0].path).toBe("src/routes.ts");

    // Transitive dependent, depth 2
    const app = byPath.get("src/app.ts")!;
    expect(app.score).toBeCloseTo(IMPACT_WEIGHTS.dependent * IMPACT_WEIGHTS.transitiveDecay);
    expect(app.reasons).toEqual(["depends on src/auth.ts (2 imports away)"]);

    // Beyond the default depth
    expect(byPath.has("src/server.ts")).toBe(false);

    // Dependencies of the changed file are off by default (weight 0)
    expect(byPath.has("src/crypto.ts")).toBe(false);

    // Tests: by name, and by importing the changed file
    expect(byPath.get("test/auth.test.ts")!.reasons).toEqual(["test named after src/auth.ts"]);
    expect(byPath.get("test/routes.test.ts")!.reasons).toEqual(["test importing src/auth.ts"]);
    expect(byPath.get("test/auth.test.ts")!.isTest).toBe(true);

    // Co-change only (not in the graph)
    expect(byPath.get("docs/auth.md")!.score).toBeCloseTo(0.3);

    // Never suggests the changed file itself
    expect(byPath.has("src/auth.ts")).toBe(false);
  });

  it("follows deeper dependents when asked", () => {
    const results = computeImpact({ changed: ["src/auth.ts"], coChanges: [], imports, files, maxDepth: 3 });
    expect(results.find((r) => r.path === "src/server.ts")?.reasons).toEqual([
      "depends on src/auth.ts (3 imports away)",
    ]);
  });

  it("damps dependents of widely imported files", () => {
    const hubImports = Array.from({ length: 32 }, (_, i) => ({ from: `src/f${i}.ts`, to: "src/types.ts" }));
    const [first] = computeImpact({ changed: ["src/types.ts"], coChanges: [], imports: hubImports, files: [] });
    expect(first.score).toBeCloseTo(IMPACT_WEIGHTS.dependent * Math.sqrt(IMPACT_WEIGHTS.hubThreshold / 32));
  });

  it("respects the limit", () => {
    expect(computeImpact({ changed: ["src/auth.ts"], coChanges: [], imports, files, limit: 2 })).toHaveLength(2);
  });
});
