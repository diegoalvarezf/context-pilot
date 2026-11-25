import { readFileSync } from "fs";
import { join } from "path";

// Un único sitio para decidir qué no se indexa: lo comparten el indexador y el watcher.

/** Carpetas (nombre exacto, sin distinguir mayúsculas) que nunca se indexan */
const IGNORE_DIR_NAMES = new Set([
  "node_modules", ".git", "__pycache__", "dist", "build", ".context-pilot",
  ".next", "coverage", ".venv", "venv", ".env",
  // código de terceros y copias antiguas
  "vendor", "phpmailer", "old", "historico", "histórico",
]);
/** Carpetas por patrón: apps borradas (`_del_X`) */
const IGNORE_DIR_PATTERNS = [/^_del_/i];
/** Librerías minificadas o empaquetadas */
const BUNDLED_FILE = /\.(min|umd|bundle)\.(js|css)$|\.min\.[a-z]+\.(js|css)$/i;

/** Un JS/CSS a partir de este tamaño se examina por contenido */
const MINIFIED_CHECK_BYTES = 20 * 1024;
/** Un JS/CSS así de grande se descarta si tiene líneas largas */
const MINIFIED_BIG_BYTES = 300 * 1024;
const MINIFIED_AVG_LINE = 300;

export interface IgnoreOptions {
  /** `ignored_paths` de `.context-pilot/config.json`: nombre de carpeta, `a/b` (prefijo) o con `*` */
  extra?: string[];
}

function globToRegex(g: string): RegExp {
  return new RegExp("^" + g.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$", "i");
}

/** Lee `ignored_paths` del config del proyecto (vacío si no existe o no es válido). */
export function loadIgnoredPaths(projectPath: string): string[] {
  try {
    const cfg = JSON.parse(readFileSync(join(projectPath, ".context-pilot", "config.json"), "utf8")) as { ignored_paths?: unknown };
    return Array.isArray(cfg.ignored_paths) ? cfg.ignored_paths.filter((p): p is string => typeof p === "string" && p.trim() !== "") : [];
  } catch {
    return [];
  }
}

/** Si una carpeta (nombre suelto) se salta siempre */
export function isIgnoredDirName(name: string): boolean {
  return IGNORE_DIR_NAMES.has(name.toLowerCase()) || IGNORE_DIR_PATTERNS.some((r) => r.test(name));
}

/** Si una ruta relativa al proyecto queda fuera del índice por su nombre, carpetas o `ignored_paths`. */
export function isIgnoredPath(relPath: string, opts: IgnoreOptions = {}): boolean {
  const parts = relPath.split(/[\\/]/).filter(Boolean);
  if (parts.length === 0) return false;
  if (parts.slice(0, -1).some(isIgnoredDirName)) return true;
  if (BUNDLED_FILE.test(parts[parts.length - 1])) return true;
  const norm = parts.join("/");
  for (const e of opts.extra ?? []) {
    const entry = e.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
    if (!entry) continue;
    if (entry.includes("/")) {
      // prefijo de ruta: coincide con la ruta o con alguna de sus carpetas contenedoras
      const re = globToRegex(entry);
      for (let i = 1; i <= parts.length; i++) if (re.test(parts.slice(0, i).join("/"))) return true;
    } else {
      const re = globToRegex(entry);
      if (parts.some((p) => re.test(p))) return true;
    }
  }
  return false;
}

/** JS/CSS minificado aunque el nombre no lo diga: pocas líneas muy largas. */
export function looksMinified(source: string, bytes: number): boolean {
  if (bytes < MINIFIED_CHECK_BYTES) return false;
  const avg = bytes / source.split("\n").length;
  return bytes >= MINIFIED_BIG_BYTES ? avg > MINIFIED_AVG_LINE : avg > MINIFIED_AVG_LINE * 3;
}

/** Comprueba por contenido un JS/CSS grande; false si no es de esos tipos o no se puede leer. */
export function isMinifiedFile(absPath: string, bytes: number): boolean {
  if (bytes < MINIFIED_CHECK_BYTES || !/\.(js|css)$/i.test(absPath)) return false;
  try {
    return looksMinified(readFileSync(absPath, "utf8"), bytes);
  } catch {
    return false;
  }
}
