import { Command } from "commander";
import { resolve } from "path";
import chalk from "chalk";
import { ContextEngine } from "context-pilot-engine";

export const impactCommand = new Command("impact")
  .description("Show what else is likely affected when you change the given files (co-changes + imports + tests)")
  .argument("<files...>", "Files you are changing")
  .option("-p, --project <path>", "Project root path", ".")
  .option("-n, --limit <n>", "Max files to show", "10")
  .option("-d, --depth <n>", "Import hops to follow for dependents", "2")
  .option("--json", "Output raw JSON", false)
  .action(
    async (files: string[], options: { project: string; limit: string; depth: string; json: boolean }) => {
      const root = resolve(options.project);
      const engine = new ContextEngine();

      try {
        // Keep history current before answering; cheap when HEAD has not moved
        await engine.mineHistory({ projectPath: root });

        const response = engine.impact({
          projectPath: root,
          files: files.map((f) => resolve(f)),
          limit: parseInt(options.limit, 10),
          depth: parseInt(options.depth, 10),
        });

        if (options.json) {
          console.log(JSON.stringify(response, null, 2));
          return;
        }

        if (!response.graphAvailable) {
          console.log(chalk.yellow("Import graph not built yet: run ") + chalk.white("context-pilot index") + chalk.yellow(" first."));
        }
        if (!response.historyAvailable) {
          console.log(chalk.yellow("No git history mined for this project."));
        }

        if (response.results.length === 0) {
          console.log(chalk.dim("Nothing else looks affected by these files."));
          return;
        }

        console.log("");
        for (const r of response.results) {
          const pct = `${Math.round(r.score * 100)}%`.padStart(4);
          console.log(`  ${chalk.cyan(pct)}  ${chalk.white(r.path)}${r.isTest ? chalk.green("  [test]") : ""}`);
          for (const reason of r.reasons) console.log(chalk.dim(`          ${reason}`));
        }
        console.log("");
      } finally {
        engine.close();
      }
    }
  );
