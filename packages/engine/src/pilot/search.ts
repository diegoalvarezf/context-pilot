// Text search over the symbol index, without embeddings: a task like "fix the
// retry delay in fetchWithRetry" is split into terms and matched against
// symbol names and file paths, weighting rare terms higher (idf).

export interface SearchSymbol {
  path: string;
  name: string;
  kind: string;
  startLine: number;
}

export interface FileHit {
  path: string;
  /** 0..1, relative to the best hit */
  score: number;
  /** Absolute match strength (sum of idf of matched terms, +4 per exact symbol name) */
  raw: number;
  /** Share of the task's terms (idf-weighted) this file matches; 1 when the task names one of its symbols */
  coverage: number;
  /** Symbols of this file that matched, best first */
  symbols: string[];
  /** Terms that matched */
  terms: string[];
}

const STOPWORDS = new Set(
  (
    "the and for with that this from into when then than not but are was were will can should would " +
    "add fix make use update change remove delete create get set new old all any some more less file files code " +
    "what does how why which where who used using also just like need want please there here have has its it's " +
    "project repo work works working does doesn don thing things way" +
    " qué cómo dónde cuál quiero necesito hay tiene funciona proyecto cosa " +
    "los las del una uno unos unas con por para que como cuando pero sin sobre este esta esto estos " +
    "hay hace hacer poner quitar cambiar arreglar añadir crear borrar nuevo nueva archivo archivos codigo código"
  ).split(" ")
);

/** Splits identifiers and prose into lower-case terms: fetchWithRetry -> fetch, with, retry. */
export function terms(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9áéíóúñü]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/** Identifiers written as such in the task (camelCase, snake_case, `quoted`). */
export function identifiers(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/`([^`]+)`/g)) for (const w of m[1].split(/[^\w$.]+/)) if (w.length >= 3) found.add(w.split(".").pop()!);
  for (const m of text.matchAll(/\b[A-Za-z_$][\w$]*\b/g)) {
    const w = m[0];
    if (/[a-z][A-Z]|_|^[A-Z][a-z]+[A-Z]/.test(w) && w.length >= 3) found.add(w);
  }
  return [...found];
}

export function searchFiles(task: string, symbols: SearchSymbol[], paths: string[], limit = 10): FileHit[] {
  const query = [...new Set(terms(task))];
  const exact = new Set(identifiers(task).map((i) => i.toLowerCase()));
  if (query.length === 0 && exact.size === 0) return [];

  // Document = file: its path terms + its symbol name terms
  const docTerms = new Map<string, Set<string>>();
  const addTerms = (path: string, ts: string[]) => {
    let set = docTerms.get(path);
    if (!set) docTerms.set(path, (set = new Set()));
    for (const t of ts) set.add(t);
  };
  for (const p of paths) addTerms(p, terms(p));
  const symTerms = new Map<SearchSymbol, string[]>();
  for (const s of symbols) {
    const ts = terms(s.name);
    symTerms.set(s, ts);
    addTerms(s.path, ts);
  }

  const symbolTerms = new Map<string, Set<string>>();
  for (const [s, ts] of symTerms) {
    let set = symbolTerms.get(s.path);
    if (!set) symbolTerms.set(s.path, (set = new Set()));
    for (const t of ts) set.add(t);
  }
  const symbolTermOf = (path: string, t: string) => symbolTerms.get(path)?.has(t) ?? false;

  const n = docTerms.size || 1;
  const df = new Map<string, number>();
  for (const set of docTerms.values()) for (const t of set) df.set(t, (df.get(t) ?? 0) + 1);
  // A term the code never uses is specific, not common: count it as rare, so missing it lowers coverage
  const idf = (t: string) => Math.log(1 + n / (df.get(t) ?? 1));

  const totalIdf = query.reduce((a, t) => a + idf(t), 0) || 1;
  const exactFiles = new Set<string>();
  const scores = new Map<string, { score: number; terms: Set<string>; symbols: Map<string, number> }>();
  const entry = (path: string) => {
    let e = scores.get(path);
    if (!e) scores.set(path, (e = { score: 0, terms: new Set(), symbols: new Map() }));
    return e;
  };

  for (const [path, set] of docTerms) {
    const base = path.split("/").pop()!.replace(/\.[^.]+$/, "");
    const nameSet = new Set(terms(base));
    const dirSet = new Set(terms(path.slice(0, -base.length)));
    for (const t of query) {
      if (!set.has(t)) continue;
      const e = entry(path);
      e.terms.add(t);
      // The file's own name says the most, then a symbol, then a folder
      e.score += idf(t) * (nameSet.has(t) ? 2.5 : dirSet.has(t) && !symbolTermOf(path, t) ? 0.6 : 1);
    }
  }
  for (const s of symbols) {
    const ts = symTerms.get(s)!;
    const hit = ts.filter((t) => query.includes(t));
    const isExact = exact.has(s.name.toLowerCase());
    if (!hit.length && !isExact) continue;
    const e = entry(s.path);
    // The symbol's own score: share of its terms the task mentions, or an exact name
    const own = isExact ? 4 : (hit.reduce((a, t) => a + idf(t), 0) * hit.length) / ts.length;
    if (isExact) {
      e.score += 4;
      exactFiles.add(s.path);
    }
    e.symbols.set(s.name, Math.max(e.symbols.get(s.name) ?? 0, own));
  }

  // Files whose matches are just one common term are noise
  const ranked = [...scores.entries()]
    .map(([path, e]) => ({
      path,
      raw: e.score,
      terms: [...e.terms],
      symbols: e.symbols,
      coverage: exactFiles.has(path) ? 1 : [...e.terms].reduce((a, t) => a + idf(t), 0) / totalIdf,
    }))
    .filter((r) => r.raw > 0)
    .sort((a, b) => b.raw - a.raw);
  const best = ranked[0]?.raw ?? 1;
  return ranked.slice(0, limit).map((r) => ({
    path: r.path,
    score: r.raw / best,
    raw: r.raw,
    coverage: r.coverage,
    terms: r.terms,
    symbols: [...r.symbols.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name),
  }));
}
