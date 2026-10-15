import { posix } from "path";
import type { ImportSpec } from "./chunker.js";

export interface ImportEdge {
  /** Importing file (project-relative, forward slashes) */
  from: string;
  /** Imported file */
  to: string;
}

const JS_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];
const JS_TO_TS: Record<string, string[]> = {
  ".js": [".ts", ".tsx"],
  ".jsx": [".tsx"],
  ".mjs": [".mts"],
  ".cjs": [".cts"],
};

/** Joins and normalizes a project-relative path; null if it escapes the project root. */
function joinRel(dir: string, spec: string): string | null {
  const p = posix.normalize(posix.join(dir, spec)).replace(/\/+$/, "");
  if (p === ".." || p.startsWith("../") || posix.isAbsolute(p)) return null;
  return p.replace(/^\.\//, "") || ".";
}

/**
 * Resolves import specifiers to project files. Built once per index run: holds
 * the file set plus a basename index for PHP namespace lookups.
 */
export class ImportResolver {
  private files: Set<string>;
  private byBasename = new Map<string, string[]>();

  constructor(files: Iterable<string>) {
    this.files = new Set(files);
    for (const f of this.files) {
      const base = posix.basename(f).toLowerCase();
      const list = this.byBasename.get(base);
      if (list) list.push(f);
      else this.byBasename.set(base, [f]);
    }
  }

  resolve(spec: ImportSpec, fromFile: string, language: string): string[] {
    const dir = posix.dirname(fromFile);
    switch (language) {
      case "javascript":
      case "typescript":
      case "tsx":
        return this.first(this.jsCandidates(spec.to, dir));
      case "python":
        return this.python(spec, dir);
      case "php":
        return this.php(spec.to, dir);
      default:
        return [];
    }
  }

  private first(candidates: Array<string | null>): string[] {
    for (const c of candidates) if (c && this.files.has(c)) return [c];
    return [];
  }

  private jsCandidates(spec: string, dir: string): Array<string | null> {
    if (!spec.startsWith(".")) return []; // package import
    const base = joinRel(dir, spec);
    if (!base) return [];
    const out: string[] = [base];
    // TS sources are imported with their emitted extension: "./foo.js" -> foo.ts
    const ext = posix.extname(base);
    for (const tsExt of JS_TO_TS[ext] ?? []) out.push(base.slice(0, -ext.length) + tsExt);
    for (const e of JS_EXTS) out.push(base + e);
    for (const e of JS_EXTS) out.push(`${base}/index${e}`);
    // `require("..")` resolves to "." here, so "./index.js" must become "index.js"
    return out.map((p) => joinRel(".", p));
  }

  private python(spec: ImportSpec, dir: string): string[] {
    const module = (p: string | null): Array<string | null> => (p ? [`${p}.py`, `${p}/__init__.py`] : []);
    const dots = spec.to.match(/^\.*/)![0].length;
    const rest = spec.to.slice(dots).replace(/\./g, "/");
    const names = spec.names ?? [];

    let roots: string[];
    if (dots > 0) {
      let base = dir;
      for (let i = 1; i < dots; i++) base = posix.dirname(base);
      roots = [base];
    } else {
      // Absolute import: try the project root and every ancestor of the importing file (src layouts)
      roots = ["."];
      for (let d = dir; d !== "." && d !== "/"; d = posix.dirname(d)) roots.push(d);
    }

    // `from pkg import mod` may import submodules; `from pkg import name` imports pkg itself
    const targets = [...names.map((n) => (rest ? `${rest}/` : "") + n.replace(/\./g, "/")), ...(rest ? [rest] : [])];

    for (const root of roots) {
      const found = new Set(targets.flatMap((t) => this.first(module(joinRel(root, t)))));
      if (found.size > 0) return [...found];
    }
    return [];
  }

  private php(spec: string, dir: string): string[] {
    const literal = spec.match(/['"]([^'"]+)['"]\s*\)?\s*$/);
    if (literal) {
      // require/include: plain string, or __DIR__ . '/path'
      const path = literal[1];
      const relative = /__DIR__|dirname\s*\(\s*__FILE__\s*\)/.test(spec) ? path.replace(/^\/+/, "") : path;
      return this.first([joinRel(dir, relative), joinRel(".", relative.replace(/^\/+/, ""))]);
    }

    // `use App\Models\User`: map the namespace onto a file path suffix (PSR-4 style).
    // Longest suffix first; only accept an unambiguous match.
    const parts = spec.split("\\").filter(Boolean);
    if (parts.length === 0) return [];
    const candidates = this.byBasename.get(`${parts[parts.length - 1]}.php`.toLowerCase()) ?? [];
    for (let i = 0; i < parts.length; i++) {
      const suffix = `${parts.slice(i).join("/")}.php`.toLowerCase();
      const matches = candidates.filter((c) => {
        const lc = c.toLowerCase();
        return lc === suffix || lc.endsWith(`/${suffix}`);
      });
      if (matches.length === 1) return matches;
      if (matches.length > 1) return [];
    }
    return [];
  }
}

/** Resolves and dedupes the import specs of one file into file-level edges. */
export function resolveFileImports(
  resolver: ImportResolver,
  fromFile: string,
  language: string,
  specs: ImportSpec[]
): ImportEdge[] {
  const targets = new Set<string>();
  for (const spec of specs) {
    for (const to of resolver.resolve(spec, fromFile, language)) if (to !== fromFile) targets.add(to);
  }
  return [...targets].map((to) => ({ from: fromFile, to }));
}
