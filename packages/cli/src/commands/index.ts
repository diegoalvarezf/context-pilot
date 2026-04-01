import { Command } from "commander";
import { resolve } from "path";
import chalk from "chalk";
import ora from "ora";
import { ContextEngine } from "@context-pilot/engine";

export const indexCommand = new Command("index")
  .description("Index or re-index the project codebase")
  .argument("[path]", "Project root path", ".")
  .option("-f, --force", "Force full re-index, ignoring cache", false)
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
