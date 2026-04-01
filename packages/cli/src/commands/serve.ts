import { Command } from "commander";
import { resolve, join } from "path";
import { existsSync } from "fs";
import chalk from "chalk";
import { ContextEngine } from "@context-pilot/engine";
import { createServer } from "@context-pilot/mcp-server/server.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { startWatcher } from "../watcher.js";

export const serveCommand = new Command("serve")
  .description("Start the context-pilot MCP server")
  .argument("[path]", "Project root path", ".")
  .option("--watch", "Auto re-index on file changes", false)
  .action(async (projectPath: string, options: { watch: boolean }) => {
    const root = resolve(projectPath);
    const configFile = join(root, ".context-pilot", "config.json");

    if (!existsSync(configFile)) {
      console.error(
        chalk.red("Not initialized.") +
          chalk.dim(` Run ${chalk.white("context-pilot init")} first.`)
      );
      process.exit(1);
    }

    const engine = new ContextEngine();
    await engine.init();

    const server = createServer(engine, root);
    const transport = new StdioServerTransport();

    process.stderr.write(`[context-pilot] serving ${root}\n`);

    if (options.watch) {
      startWatcher(root, engine);
      process.stderr.write("[context-pilot] file watcher active\n");
    }

    await server.connect(transport);
  });
