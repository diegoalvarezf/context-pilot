import { Command } from "commander";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, resolve } from "path";
import chalk from "chalk";
import ora from "ora";

const DEFAULT_CONFIG = {
  token_budget: 8000,
  model: "all-MiniLM-L6-v2",
  ignored_paths: ["node_modules", ".git", "__pycache__", "dist", "build"],
  languages: ["typescript", "javascript", "python"],
};

export const initCommand = new Command("init")
  .description("Initialize context-pilot in a project")
  .argument("[path]", "Project root path", ".")
  .option("--token-budget <number>", "Max tokens per context response", "8000")
  .action(async (projectPath: string, options: { tokenBudget: string }) => {
    const root = resolve(projectPath);
    const configDir = join(root, ".context-pilot");
    const configFile = join(configDir, "config.json");

    if (existsSync(configFile)) {
      console.log(chalk.yellow(`Already initialized at ${root}`));
      console.log(chalk.dim(`Config: ${configFile}`));
      console.log(chalk.dim(`Run ${chalk.white("context-pilot index")} to re-index.`));
      return;
    }

    const spinner = ora("Initializing context-pilot...").start();

    mkdirSync(configDir, { recursive: true });

    const config = {
      ...DEFAULT_CONFIG,
      token_budget: parseInt(options.tokenBudget, 10),
      project_path: root,
      created_at: new Date().toISOString(),
    };

    writeFileSync(configFile, JSON.stringify(config, null, 2));

    // Add .context-pilot/db.sqlite to .gitignore if it exists
    const gitignorePath = join(root, ".gitignore");
    if (existsSync(gitignorePath)) {
      const { readFileSync, appendFileSync } = await import("fs");
      const gitignore = readFileSync(gitignorePath, "utf8");
      if (!gitignore.includes(".context-pilot/")) {
        appendFileSync(gitignorePath, "\n# context-pilot\n.context-pilot/db.sqlite\n");
      }
    }

    spinner.succeed(chalk.green("context-pilot initialized"));
    console.log("");
    console.log(chalk.dim("  Config written to: ") + chalk.white(configFile));
    console.log("");
    console.log("Next steps:");
    console.log("  " + chalk.cyan("context-pilot index") + chalk.dim("   — index your codebase"));
    console.log(
      "  " + chalk.cyan("context-pilot serve") + chalk.dim("   — start the MCP server")
    );
    console.log("");
    console.log(chalk.dim("Add to Claude Code:"));
    console.log(
      "  " + chalk.white(`claude mcp add context-pilot -- context-pilot serve --project ${root}`)
    );
    console.log("");
  });
