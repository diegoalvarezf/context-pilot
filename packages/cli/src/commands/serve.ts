import { Command } from "commander";
import { resolve } from "path";
import { ContextEngine } from "context-pilot-engine";
import { createServer } from "context-pilot-mcp-server/server.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { startWatcher } from "../watcher.js";

export const serveCommand = new Command("serve")
  .description("Start the context-pilot MCP server")
  .argument("[path]", "Project root path", ".")
  .option("--watch", "Auto re-index on file changes", false)
  .action(async (projectPath: string, options: { watch: boolean }) => {
    const root = resolve(projectPath);
    // Agents start the server in any project: it needs no setup and writes nothing there

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
