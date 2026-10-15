import { Command } from "commander";
import { resolve } from "path";
import chalk from "chalk";
import ora from "ora";
import { ContextEngine } from "context-pilot-engine";

export const indexCommand = new Command("index")
  .description("Index the codebase and mine git history for co-changes")
  .argument("[path]", "Project root path", ".")
  .option("-f, --force", "Force full re-index and re-mine history", false)
  .action(async (projectPath: string, options: { force: boolean }) => {
    const root = resolve(projectPath);
    const spinner = ora(`Indexing ${chalk.cyan(root)}...`).start();

    const engine = new ContextEngine();

    try {
      await engine.init();
      const result = await engine.index({ projectPath: root, force: options.force });

      if (!result.success) {
        spinner.fail(chalk.red("Indexing failed: ") + (result.error ?? "unknown error"));
        return;
      }

      spinner.succeed(chalk.green("Indexing complete"));
      console.log("");
      console.log(
        "  " + chalk.dim("Files indexed:  ") + chalk.white(result.filesIndexed.toLocaleString())
      );
      console.log(
        "  " + chalk.dim("Files skipped:  ") +
          chalk.dim(result.filesSkipped.toLocaleString() + " (unchanged)")
      );
      console.log(
        "  " + chalk.dim("Total files:    ") + chalk.white(result.totalFiles.toLocaleString())
      );
      const h = result.history;
      if (h && (h.status === "full" || h.status === "incremental" || h.status === "up-to-date")) {
        console.log(
          "  " + chalk.dim("Git history:    ") +
            chalk.white(`${h.commitsProcessed.toLocaleString()} commits`) +
            chalk.dim(` (${h.status}, ${h.commitsSkipped} skipped, ${h.pairs.toLocaleString()} co-change pairs)`)
        );
      } else if (h) {
        console.log("  " + chalk.dim("Git history:    ") + chalk.yellow(h.error ?? h.status));
      }
      console.log("");
      console.log(
        chalk.dim("Run ") +
          chalk.white("context-pilot serve") +
          chalk.dim(" to start the MCP server.")
      );
    } catch (err) {
      spinner.fail(chalk.red("Error: ") + String(err));
    } finally {
      engine.close();
    }
  });
