import { posix } from "path";
import type { CoChangeResult } from "../history/cochange.js";
import type { ImportEdge } from "../indexer/imports.js";

export type ImpactSignalKind = "co-change" | "dependent" | "dependency" | "test";

export interface ImpactSignal {
  kind: ImpactSignalKind;
  /** Contribution in [0,1] before combining */
  weight: number;
  /** Changed file this signal comes from */
  via: string;
  /** Import distance for dependents (1 = imports the changed file directly) */
  depth?: number;
  /** Shared commits / commits of `via`, for co-change signals */
  support?: number;
  sourceCommits?: number;
}

export interface ImpactResult {
  path: string;
  /** Noisy-OR of all signals, in [0,1] */
  score: number;
  isTest: boolean;
  signals: ImpactSignal[];
  reasons: string[];
}

/**
 * Signal weights. Structural weights are priors, not calibrated yet: run
 * `context-pilot backtest --with-graph` on real repos to tune them.
 */
export const IMPACT_WEIGHTS = {
  /** File that imports a changed file */
  dependent: 0.45,
  /** Each further hop of transitive dependents multiplies by this */
  transitiveDecay: 0.4,
  /** File that a changed file imports */
  dependency: 0.1,
  /** Test file matched by name, or a test importing a changed file */
  test: 0.6,
  /** Dependents of a file imported by more than this many files are damped (hubs) */
  hubThreshold: 8,
} as const;

export const DEFAULT_IMPACT_DEPTH = 2;

const TEST_PATTERNS = [
  /(^|\/)(tests?|__tests__|specs?)\//i,
  /\.(test|spec)\.[^/.]+$/i,
  /(^|\/)test_[^/]+\.py$/i,
  /_test\.[^/.]+$/i,
  /[^/]Test\.php$/,
];

export function isTestFile(path: string): boolean {
  return TEST_PATTERNS.some((re) => re.test(path));
}

/** Basename without extension and test markers: "test/auth.test.ts" -> "auth", "AuthTest.php" -> "auth". */
export function testStem(path: string): string {
  let base = posix.basename(path);
  base = base.replace(/\.[^.]+$/, "").replace(/\.(test|spec)$/i, "");
  base = base.replace(/^test_/i, "").replace(/_test$/i, "").replace(/(.)Test$/, "$1");
  return base.toLowerCase();
}

export interface ImpactInput {
  changed: string[];
  coChanges: CoChangeResult[];
  imports: ImportEdge[];
  /** All files currently in the project, for test-by-name matching */
  files: Iterable<string>;
  maxDepth?: number;
  limit?: number;
}

export function computeImpact(input: ImpactInput): ImpactResult[] {
  const changed = new Set(input.changed);
  const maxDepth = input.maxDepth ?? DEFAULT_IMPACT_DEPTH;
  const W = IMPACT_WEIGHTS;

  const importers = new Map<string, string[]>();
  const imported = new Map<string, string[]>();
  for (const e of input.imports) {
    (importers.get(e.to) ?? importers.set(e.to, []).get(e.to)!).push(e.from);
    (imported.get(e.from) ?? imported.set(e.from, []).get(e.from)!).push(e.to);
  }

  const signals = new Map<string, ImpactSignal[]>();
  const add = (path: string, s: ImpactSignal): void => {
    if (changed.has(path) || s.weight <= 0) return;
    (signals.get(path) ?? signals.set(path, []).get(path)!).push(s);
  };

  for (const r of input.coChanges) {
    for (const src of r.sources) {
      add(r.path, {
        kind: "co-change",
        weight: src.confidence,
        via: src.file,
        support: src.support,
        sourceCommits: src.sourceCommits,
      });
    }
  }

  for (const file of changed) {
    // Dependents, breadth-first over reverse import edges
    const seen = new Set<string>([file]);
    let frontier = [file];
    for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
      const next: string[] = [];
      for (const node of frontier) {
        const deps = importers.get(node) ?? [];
        // A widely imported module (types, utils) rarely forces every importer to change
        const damping = Math.min(1, Math.sqrt(W.hubThreshold / Math.max(1, deps.length)));
        for (const dep of deps) {
          if (seen.has(dep)) continue;
          seen.add(dep);
          next.push(dep);
          const base = W.dependent * Math.pow(W.transitiveDecay, depth - 1) * damping;
          const directTest = depth === 1 && isTestFile(dep);
          add(dep, {
            kind: directTest ? "test" : "dependent",
            weight: directTest ? Math.max(base, W.test) : base,
            via: file,
            depth,
          });
        }
      }
      frontier = next;
    }

    for (const dep of imported.get(file) ?? []) {
      add(dep, { kind: "dependency", weight: W.dependency, via: file });
    }
  }

  // Tests matched by name (covers tests that don't import the file, e.g. PHP/Python suites)
  const stems = new Map<string, string[]>();
  for (const f of changed) {
    if (isTestFile(f)) continue;
    const stem = testStem(f);
    (stems.get(stem) ?? stems.set(stem, []).get(stem)!).push(f);
  }
  if (stems.size > 0) {
    for (const f of input.files) {
      if (!isTestFile(f)) continue;
      for (const via of stems.get(testStem(f)) ?? []) add(f, { kind: "test", weight: W.test, via });
    }
  }

  const results: ImpactResult[] = [];
  for (const [path, list] of signals) {
    // Keep the strongest signal per (kind, via) so one relationship isn't counted twice
    const best = new Map<string, ImpactSignal>();
    for (const s of list) {
      const key = `${s.kind}\0${s.via}`;
      const prev = best.get(key);
      if (!prev || s.weight > prev.weight) best.set(key, s);
    }
    const kept = [...best.values()].sort((a, b) => b.weight - a.weight);
    const score = 1 - kept.reduce((acc, s) => acc * (1 - Math.min(1, s.weight)), 1);
    results.push({ path, score, isTest: isTestFile(path), signals: kept, reasons: kept.map(describeSignal) });
  }

  results.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return input.limit ? results.slice(0, input.limit) : results;
}

export function describeSignal(s: ImpactSignal): string {
  switch (s.kind) {
    case "co-change":
      return `changed together with ${s.via} in ${s.support} of ${s.sourceCommits} commits`;
    case "dependent":
      return s.depth === 1 ? `imports ${s.via}` : `depends on ${s.via} (${s.depth} imports away)`;
    case "dependency":
      return `imported by ${s.via}`;
    case "test":
      return s.depth ? `test importing ${s.via}` : `test named after ${s.via}`;
  }
}
