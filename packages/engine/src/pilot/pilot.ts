import { isTestFile, type ImpactResult } from "../impact/impact.js";
import type { FileHit } from "./search.js";

// The pilot: given a task, a compact map of where to look — files in order,
// their outline with line ranges, the code of the symbols that matter most —
// plus what else will likely change and which tests cover it. All within a
// token budget, so the agent doesn't need to grep around and read whole files.

export interface OutlineSymbol {
  name: string;
  kind: string;
  parent: string | null;
  startLine: number;
  endLine: number;
  signature: string;
}

export interface PilotFile {
  path: string;
  score: number;
  isTest: boolean;
  reasons: string[];
  /** Symbols that matched the task, best first */
  matched: string[];
}

export interface PilotResult {
  /** The map, ready to hand to the agent */
  text: string;
  files: PilotFile[];
  tests: string[];
  /** How sure we are the map points at the right code: 0..1 */
  confidence: number;
  tokens: number;
  /** What reading every file in the map in full would have cost */
  tokensIfRead: number;
}

export interface PilotInput {
  task: string;
  /** Files the agent already named or has open */
  files: string[];
  hits: FileHit[];
  /** Impact of the seed files: co-changes, importers, tests */
  impact: ImpactResult[];
  outline: (path: string) => OutlineSymbol[];
  fileTokens: (path: string) => number;
  /** Source lines [start, end] of a file, or null when unreadable */
  lines: (path: string, start: number, end: number) => string | null;
  budget: number;
}

export const DEFAULT_PILOT_BUDGET = 1500;
const IMPACT_WEIGHT = 0.6;
const MAX_FILES = 12;
const MAX_OUTLINE = 10;
const MAX_SNIPPET_LINES = 40;

export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

export function rankPilotFiles(input: Pick<PilotInput, "files" | "hits" | "impact">): PilotFile[] {
  const byPath = new Map<string, PilotFile>();
  const add = (path: string, score: number, reason: string | null, matched: string[] = []) => {
    const f = byPath.get(path) ?? { path, score: 0, isTest: isTestFile(path), reasons: [], matched: [] };
    // Independent pieces of evidence combine like noisy-OR
    f.score = 1 - (1 - f.score) * (1 - score);
    if (reason && !f.reasons.includes(reason)) f.reasons.push(reason);
    for (const m of matched) if (!f.matched.includes(m)) f.matched.push(m);
    byPath.set(path, f);
  };

  for (const p of input.files) add(p, 1, "you're working on it");
  for (const h of input.hits) {
    const why = h.symbols.length
      ? `defines ${h.symbols.slice(0, 3).join(", ")}`
      : `name matches "${h.terms.slice(0, 3).join(", ")}"`;
    add(h.path, h.score * 0.9, why, h.symbols);
  }
  for (const r of input.impact) add(r.path, r.score * IMPACT_WEIGHT, r.reasons[0] ?? null);

  return [...byPath.values()].sort((a, b) => b.score - a.score).slice(0, MAX_FILES);
}

function outlineLine(s: OutlineSymbol): string {
  const range = s.startLine === s.endLine ? `L${s.startLine}` : `L${s.startLine}-${s.endLine}`;
  return `    ${range}  ${s.signature}`;
}

export function pilot(input: PilotInput): PilotResult {
  const files = rankPilotFiles(input);
  const tests = files.filter((f) => f.isTest).map((f) => f.path);
  const seen = new Set<string>();
  const out: string[] = [];
  const later: string[] = [];
  let used = 0;
  const fits = (text: string) => used + estimateTokens(text) <= input.budget;
  const push = (text: string) => {
    out.push(text);
    used += estimateTokens(text) + 1;
  };

  push(`context-pilot map for: ${input.task.trim().slice(0, 200)}`);
  for (const f of files) {
    if (f.isTest) continue;
    const head = `\n${f.path} — ${f.reasons.slice(0, 2).join("; ")}`;
    if (!fits(head)) {
      later.push(f.path);
      continue;
    }
    push(head);
    seen.add(f.path);

    const outline = input.outline(f.path);
    const rank = (s: OutlineSymbol) => f.matched.indexOf(s.name);
    const matched = outline.filter((s) => rank(s) >= 0).sort((a, b) => rank(a) - rank(b));
    // Unmatched constants are noise; top-level functions and classes show the file's shape
    const rest = outline.filter((s) => rank(s) < 0 && s.parent === null && s.kind !== "const");
    const total = matched.length + rest.length;
    for (const s of [...matched, ...rest].slice(0, MAX_OUTLINE)) {
      const line = outlineLine(s);
      if (!fits(line)) break;
      push(line);
    }
    if (total > MAX_OUTLINE) push(`    … ${total - MAX_OUTLINE} more`);

    // The code of the best match, when it's small enough to be worth it
    const best = matched[0];
    if (best && best.endLine - best.startLine < MAX_SNIPPET_LINES) {
      const code = input.lines(f.path, best.startLine, best.endLine);
      const block = code && `    \`\`\`\n${code.replace(/^/gm, "    ")}\n    \`\`\``;
      if (block && fits(block)) push(block);
    }
  }

  const others = [...later, ...files.filter((f) => !seen.has(f.path) && !f.isTest && !later.includes(f.path)).map((f) => f.path)];
  if (others.length) push(`\nAlso related: ${others.join(", ")}`);
  if (tests.length) push(`Tests to run or update: ${tests.join(", ")}`);
  push("Read only the line ranges you need.");

  const text = out.join("\n");
  // How much of the task the best files explain: a task that names code is covered, small talk isn't
  const coverage = Math.max(0, ...input.hits.slice(0, 3).map((h) => h.coverage));
  const confidence = input.files.length ? 1 : coverage;
  return {
    text,
    files,
    tests,
    confidence,
    tokens: estimateTokens(text),
    tokensIfRead: files.reduce((a, f) => a + input.fileTokens(f.path), 0),
  };
}
