import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { randomUUID } from "crypto";
import type Database from "better-sqlite3";
import { PythonBridge } from "./bridge/python-bridge.js";
import { queryContextSchema, handleQueryContext } from "./tools/query-context.js";
import { indexProjectSchema, handleIndexProject } from "./tools/index-project.js";
import { rememberSchema, handleRemember } from "./tools/remember.js";
import { getGraphSchema, handleGetGraph } from "./tools/get-graph.js";
import { searchCodeSchema, handleSearchCode } from "./tools/search-code.js";

const DEFAULT_PROJECT_ID = "default";
const SESSION_ID = randomUUID();

export function createServer(db: Database.Database, projectPath: string): McpServer {
  const bridge = new PythonBridge();
  bridge.start();

  const server = new McpServer({
    name: "context-pilot",
    version: "0.1.0",
  });

  server.tool(
    "query_context",
    "Retrieves the most relevant code context for a given prompt. Call this before generating code to get related functions, patterns, and architectural decisions.",
    queryContextSchema.shape,
    async ({ prompt, active_file, token_budget, context_types }) => {
      const result = await handleQueryContext(
        { prompt, active_file, token_budget, context_types },
        bridge,
        projectPath
      );
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "index_project",
    "Index or re-index the project codebase. Run when starting a new session or after significant changes.",
    indexProjectSchema.shape,
    async ({ project_path, force, paths }) => {
      const result = await handleIndexProject({ project_path, force, paths }, bridge);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "remember",
    "Store an architectural decision, pattern, or important note that should persist across sessions.",
    rememberSchema.shape,
    async ({ content, memory_type, related_files }) => {
      const result = handleRemember(db, DEFAULT_PROJECT_ID, SESSION_ID, {
        content,
        memory_type,
        related_files,
      });
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "get_graph",
    "Get the dependency graph around a file or function. Useful for understanding the impact of changes.",
    getGraphSchema.shape,
    async ({ target, depth, direction }) => {
      const result = await handleGetGraph({ target, depth, direction }, bridge, projectPath);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "search_code",
    "Semantically search the codebase for functions, classes, or patterns.",
    searchCodeSchema.shape,
    async ({ query, k, filter_type }) => {
      const result = await handleSearchCode(
        { query, k, filter_type },
        bridge,
        projectPath
      );
      return { content: [{ type: "text", text: result }] };
    }
  );

  return server;
}
