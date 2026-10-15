import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { IContextEngine } from "context-pilot-engine";
import { coChangesSchema, handleCoChanges } from "./tools/co-changes.js";
import { indexProjectSchema, handleIndexProject } from "./tools/index-project.js";
import { getGraphSchema, handleGetGraph } from "./tools/get-graph.js";

export function createServer(engine: IContextEngine, projectPath: string): McpServer {
  const server = new McpServer({
    name: "context-pilot",
    version: "0.3.0",
  });

  server.tool(
    "co_changes",
    "Given the files you are changing, returns other files that historically change together with them " +
      "in this repo's git history, with how often and why. Call it before finishing a change to catch files " +
      "you may have forgotten (tests, configs, sibling modules, migrations).",
    coChangesSchema.shape,
    async ({ files, limit, min_support }) => {
      const result = await handleCoChanges({ files, limit, min_support }, engine, projectPath);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "index_project",
    "Index the project: parses source files for the import graph and mines git history for co-changes. " +
      "Incremental and cheap to re-run; run it at the start of a session or after pulling new commits.",
    indexProjectSchema.shape,
    async ({ force }) => {
      const result = await handleIndexProject({ force }, engine, projectPath);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "get_graph",
    "Get the import graph around a file or function: what it depends on and what depends on it.",
    getGraphSchema.shape,
    async ({ target, depth, direction }) => {
      const result = await handleGetGraph({ target, depth, direction }, engine, projectPath);
      return { content: [{ type: "text", text: result }] };
    }
  );

  return server;
}
