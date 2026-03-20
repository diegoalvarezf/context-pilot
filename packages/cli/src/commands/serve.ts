import { Command } from "commander";
import { resolve, join } from "path";
import { homedir } from "os";
import { existsSync } from "fs";
import chalk from "chalk";
import { openDatabase } from "@context-pilot/mcp-server/storage/sqlite.js";
import { createServer } from "@context-pilot/mcp-server/server.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

export const serveCommand = new Command("serve")
  .description("Start the context-pilot MCP server")
  .argument("[path]", "Project root path", ".")
  .option("--db <path>", "Custom database path")
  .action(async (projectPath: string, options: { db?: string }) => {
    const root = resolve(projectPath);
    const configFile = join(root, ".context-pilot", "config.json");

    if (!existsSync(configFile)) {
      console.error(
        chalk.red("Not initialized.") +
          chalk.dim(` Run ${chalk.white("context-pilot init")} first.`)
      );
      process.exit(1);
    }

    const dbPath = options.db ?? join(homedir(), ".context-pilot", "db.sqlite");
    const db = openDatabase(dbPath);
    const server = createServer(db, root);
    const transport = new StdioServerTransport();

    process.stderr.write(
      `[context-pilot] serving ${root}\n`
    );

    await server.connect(transport);
  });
