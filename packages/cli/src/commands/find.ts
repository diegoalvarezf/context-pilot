import { Command } from "commander";
import { resolve } from "path";
import { ContextEngine, formatFindSymbol } from "context-pilot-engine";

export const findCommand = new Command("find")
  .description("Where a function, class or constant is defined and every place it's used (a precise grep)")
  .argument("<name>", "Symbol name (Class.method works)")
  .option("-p, --project <path>", "Project root path", ".")
  .option("-n, --limit <n>", "Max files with uses to list", "30")
  .option("--json", "Output raw JSON", false)
  .action(async (name: string, options: { project: string; limit: string; json: boolean }) => {
    const root = resolve(options.project);
    const engine = new ContextEngine();
    try {
      await engine.ensureFresh({ projectPath: root });
      const r = engine.findSymbol({ projectPath: root, name, limit: parseInt(options.limit, 10) });
      console.log(options.json ? JSON.stringify(r, null, 2) : formatFindSymbol(r));
    } finally {
      engine.close();
    }
  });
