import { Command } from "commander";
import { resolve } from "path";
import chalk from "chalk";
import ora from "ora";
import { PythonBridge } from "@context-pilot/mcp-server/bridge/python-bridge.js";

interface IndexResult {
  success: boolean;
  project_path?: string;
  files_indexed?: number;
  files_skipped?: number;
  total_files?: number;
  error?: string;
}

export const indexCommand = new Command("index")
  .description("Index or re-index the project codebase")
  .argument("[path]", "Project root path", ".")
  .option("-f, --force", "Force full re-index, ignoring cache", false)
  .action(async (projectPath: string, options: { force: boolean }) => {
    const root = resolve(projectPath);
    const spinner = ora(`Indexing ${chalk.cyan(root)}...`).start();

    const bridge = new PythonBridge();
    bridge.start();

    try {
      const result = await bridge.call<IndexResult>("index", {
        project_path: root,
        force: options.force,
      });

      if (!result.success) {
        spinner.fail(chalk.red("Indexing failed: ") + (result.error ?? "unknown error"));
        return;
      }

      spinner.succeed(chalk.green("Indexing complete"));
      console.log("");
      console.log(
        "  " + chalk.dim("Files indexed:  ") + chalk.white(result.files_indexed?.toLocaleString())
      );
      console.log(
        "  " + chalk.dim("Files skipped:  ") +
          chalk.dim(result.files_skipped?.toLocaleString() + " (unchanged)")
      );
      console.log(
        "  " + chalk.dim("Total files:    ") + chalk.white(result.total_files?.toLocaleString())
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
      bridge.stop();
    }
  });
