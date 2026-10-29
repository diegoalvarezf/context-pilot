import { Command } from "commander";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, resolve } from "path";
import chalk from "chalk";
import ora from "ora";

const DEFAULT_CONFIG = {
  ignored_paths: ["node_modules", ".git", "__pycache__", "dist", "build"],
  history: {
    max_commits: 5000,
    max_files_per_commit: 30,
  },
};

/**
 * Writes `.context-pilot/config.json` unless it exists. Returns whether it was created.
 * Nothing else in the project is touched: the index lives in ~/.context-pilot, not here.
 */
export function initProject(root: string): { created: boolean; configFile: string } {
  const configDir = join(root, ".context-pilot");
  const configFile = join(configDir, "config.json");
  if (existsSync(configFile)) return { created: false, configFile };

  mkdirSync(configDir, { recursive: true });
  const config = {
    ...DEFAULT_CONFIG,
    project_path: root,
    created_at: new Date().toISOString(),
  };
  writeFileSync(configFile, JSON.stringify(config, null, 2));
  return { created: true, configFile };
}

export const initCommand = new Command("init")
  .description("Initialize context-pilot in a project")
  .argument("[path]", "Project root path", ".")
  .action(async (projectPath: string) => {
    const root = resolve(projectPath);
    const spinner = ora("Initializing context-pilot...").start();
    const { created, configFile } = initProject(root);

    if (!created) {
      spinner.stop();
      console.log(chalk.yellow(`Already initialized at ${root}`));
      console.log(chalk.dim(`Config: ${configFile}`));
      console.log(chalk.dim(`Run ${chalk.white("context-pilot index")} to re-index.`));
      return;
    }

    spinner.succeed(chalk.green("context-pilot initialized"));
    console.log("");
    console.log(chalk.dim("  Config written to: ") + chalk.white(configFile));
    console.log("");
    console.log("Next steps:");
    console.log("  " + chalk.cyan("context-pilot index") + chalk.dim("   — index code and git history"));
    console.log(
      "  " + chalk.cyan("context-pilot serve") + chalk.dim("   — start the MCP server")
    );
    console.log("");
    console.log(chalk.dim("Or do everything at once (index, hooks, Claude Code): ") + chalk.cyan("context-pilot setup"));
    console.log("");
  });
