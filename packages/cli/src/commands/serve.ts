import { Command } from "commander";
import { resolve, join } from "path";
import { existsSync } from "fs";
import { ContextEngine } from "context-pilot-engine";
import { createServer } from "context-pilot-mcp-server/server.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { startWatcher } from "../watcher.js";
import { initProject } from "./init.js";

export const serveCommand = new Command("serve")
  .description("Start the context-pilot MCP server")
  .argument("[path]", "Project root path", ".")
  .option("--watch", "Auto re-index on file changes", false)
  .action(async (projectPath: string, options: { watch: boolean }) => {
    const root = resolve(projectPath);
    const configFile = join(root, ".context-pilot", "config.json");

    // Agents start the server on their own: set the project up instead of refusing
    if (!existsSync(configFile)) initProject(root);

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
