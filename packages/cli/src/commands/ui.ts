import { Command } from "commander";
import { resolve, join } from "path";
import { existsSync } from "fs";
import chalk from "chalk";
import ora from "ora";
import { ContextEngine } from "@context-pilot/engine";
import { startUiServer } from "@context-pilot/ui-server";

export const uiCommand = new Command("ui")
  .description("Open the context-pilot visual UI in your browser")
  .argument("[path]", "Project root path", ".")
  .option("-p, --port <port>", "Port to listen on", "4321")
  .action(async (projectPath: string, options: { port: string }) => {
    const root = resolve(projectPath);
    const port = parseInt(options.port, 10);
    const configFile = join(root, ".context-pilot", "config.json");

    if (!existsSync(configFile)) {
      console.error(
        chalk.red("Not initialized.") +
          chalk.dim(` Run ${chalk.white("context-pilot init")} first.`)
      );
      process.exit(1);
    }

    const spinner = ora("Starting UI server...").start();

    const engine = new ContextEngine();
    await engine.init();

    await startUiServer(engine, root, port);

    spinner.succeed(`UI running at ${chalk.cyan(`http://localhost:${port}`)}`);
    console.log(chalk.dim(`Project: ${root}`));
    console.log(chalk.dim("Press Ctrl+C to stop."));

    // Keep process alive
    process.on("SIGINT", () => {
      engine.close();
      process.exit(0);
    });
  });
