import { watch } from "chokidar";
import { relative, resolve, sep } from "path";
import { isIgnoredPath, loadIgnoredPaths, type IContextEngine } from "context-pilot-engine";

const DEBOUNCE_MS = 1500;
const SUPPORTED_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".php", ".html", ".htm", ".css", ".swift", ".cs"]);

export function startWatcher(projectPath: string, engine: IContextEngine): void {
  const root = resolve(projectPath);
  let debounceTimer: NodeJS.Timeout | null = null;
  const changedFiles = new Set<string>();

  const extra = loadIgnoredPaths(root);
  const watcher = watch(root, {
    // misma lista que el indexador, sobre la ruta relativa (no sobre la carpeta raíz)
    ignored: (p: string) => {
      const rel = relative(root, p).split(sep).join("/");
      return rel !== "" && (/^\.git(\/|$)/.test(rel) || isIgnoredPath(rel + "/x", { extra }) || isIgnoredPath(rel, { extra }));
    },
    persistent: true,
    ignoreInitial: true,
  });

  const scheduleReindex = (filePath: string) => {
    const ext = filePath.slice(filePath.lastIndexOf("."));
    if (!SUPPORTED_EXTS.has(ext)) return;

    changedFiles.add(filePath);

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      const files = [...changedFiles];
      changedFiles.clear();
      process.stderr.write(
        `[context-pilot] re-indexing ${files.length} changed file(s)...\n`
      );
      try {
        await engine.index({ projectPath: root, force: false, paths: files });
        process.stderr.write("[context-pilot] re-index complete\n");
      } catch (err) {
        process.stderr.write(`[context-pilot] re-index failed: ${err}\n`);
      }
    }, DEBOUNCE_MS);
  };

  watcher.on("add", scheduleReindex);
  watcher.on("change", scheduleReindex);
  watcher.on("unlink", scheduleReindex);

  process.on("SIGINT", () => { watcher.close(); process.exit(0); });
  process.on("SIGTERM", () => { watcher.close(); process.exit(0); });
}
