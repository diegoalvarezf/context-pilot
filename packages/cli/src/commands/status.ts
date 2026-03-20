import { Command } from "commander";
import { resolve } from "path";
import chalk from "chalk";
import ora from "ora";
import { PythonBridge } from "@context-pilot/mcp-server/bridge/python-bridge.js";

interface StatusResult {
  indexed: boolean;
  project_path?: string;
  project_id?: string;
  files?: number;
  chunks?: number;
  indexed_at?: number;
}

export const statusCommand = new Command("status")
  .description("Show indexing status for a project")
  .argument("[path]", "Project root path", ".")
  .action(async (projectPath: string) => {
    const root = resolve(projectPath);
    const spinner = ora("Checking status...").start();

    const bridge = new PythonBridge();
    bridge.start();

    try {
      const result = await bridge.call<StatusResult>("status", { project_path: root });
      spinner.stop();

      if (!result.indexed) {
        console.log(chalk.yellow("Not indexed") + chalk.dim(` — ${root}`));
        console.log(chalk.dim(`Run ${chalk.white("context-pilot index")} to get started.`));
        return;
      }

      const indexedAt = result.indexed_at
        ? new Date(result.indexed_at * 1000).toLocaleString()
        : "unknown";

      console.log("");
      console.log(chalk.green("✓") + " " + chalk.bold("context-pilot") + chalk.dim(` — ${root}`));
      console.log("");
      console.log(
        "  " + chalk.dim("Files indexed:  ") + chalk.white(result.files?.toLocaleString())
      );
      console.log(
        "  " + chalk.dim("Chunks:         ") + chalk.white(result.chunks?.toLocaleString())
      );
      console.log("  " + chalk.dim("Last indexed:   ") + chalk.white(indexedAt));
      console.log("");
    } finally {
      bridge.stop();
    }
  });
