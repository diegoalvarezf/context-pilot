import { Command } from "commander";
import { resolve } from "path";
import { ContextEngine, formatOutline } from "context-pilot-engine";

export const outlineCommand = new Command("outline")
  .description("Functions, classes and methods of a file with their line ranges, without the bodies")
  .argument("<files...>", "Files to outline")
  .option("-p, --project <path>", "Project root path", ".")
  .option("--json", "Output raw JSON", false)
  .action(async (files: string[], options: { project: string; json: boolean }) => {
    const root = resolve(options.project);
    const engine = new ContextEngine();
    try {
      await engine.ensureFresh({ projectPath: root });
      const results = files.map((f) => engine.outline({ projectPath: root, file: resolve(f) }));
      console.log(options.json ? JSON.stringify(results, null, 2) : results.map(formatOutline).join("\n\n"));
    } finally {
      engine.close();
    }
  });
