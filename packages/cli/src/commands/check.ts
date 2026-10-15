import { Command } from "commander";
import { resolve } from "path";
import chalk from "chalk";
import { ContextEngine, DEFAULT_CHECK_MIN_SCORE } from "context-pilot-engine";

export const checkCommand = new Command("check")
  .description("Check your uncommitted changes for files you probably forgot to touch")
  .option("-p, --project <path>", "Project root path", ".")
  .option("--staged", "Only staged changes (for a pre-commit hook)", false)
  .option("--base <ref>", "Check the whole branch against its merge-base with <ref>")
  .option("--min-score <n>", "Only report files whose strongest signal reaches this (0-1)", String(DEFAULT_CHECK_MIN_SCORE))
  .option("-n, --limit <n>", "Max files to show", "10")
  .option("--strict", "Exit with code 1 when likely-missing files are found", false)
  .option("--json", "Output raw JSON", false)
  .action(
    async (options: {
      project: string;
      staged: boolean;
      base?: string;
      minScore: string;
      limit: string;
      strict: boolean;
      json: boolean;
    }) => {
      const root = resolve(options.project);
      const engine = new ContextEngine();

      try {
        // Keep history current before answering; cheap when HEAD has not moved
        await engine.mineHistory({ projectPath: root });

        const response = await engine.checkChange({
          projectPath: root,
          staged: options.staged,
          base: options.base,
          minScore: parseFloat(options.minScore),
          limit: parseInt(options.limit, 10),
        });

        if (options.json) {
          console.log(JSON.stringify(response, null, 2));
        } else if (response.skipped) {
          console.log(chalk.dim(`Not checked: ${response.skipped}.`));
        } else if (response.changed.length === 0) {
          console.log(chalk.dim("No changes to check."));
        } else {
          if (!response.graphAvailable) {
            console.log(chalk.yellow("Import graph not built yet: run ") + chalk.white("context-pilot index") + chalk.yellow(" for better results."));
          }
          const n = response.changed.length;
          console.log(chalk.dim(`Checked ${n} changed file${n === 1 ? "" : "s"}.`));
          if (response.missing.length === 0) {
            console.log(chalk.green("Nothing obviously missing."));
          } else {
            console.log(chalk.yellow("\nYou may also need to change:\n"));
            for (const r of response.missing) {
              const pct = `${Math.round(r.score * 100)}%`.padStart(4);
              console.log(`  ${chalk.cyan(pct)}  ${chalk.white(r.path)}${r.isTest ? chalk.green("  [test]") : ""}`);
              for (const reason of r.reasons) console.log(chalk.dim(`          ${reason}`));
            }
            console.log("");
          }
        }

        if (options.strict && response.missing.length > 0) process.exitCode = 1;
      } finally {
        engine.close();
      }
    }
  );
