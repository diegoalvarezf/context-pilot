import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { IContextEngine } from "context-pilot-engine";
import { coChangesSchema, handleCoChanges } from "./tools/co-changes.js";
import { impactOfSchema, handleImpactOf } from "./tools/impact-of.js";
import { checkChangeSchema, handleCheckChange } from "./tools/check-change.js";
import { indexProjectSchema, handleIndexProject } from "./tools/index-project.js";
import { getGraphSchema, handleGetGraph } from "./tools/get-graph.js";
import { pilotSchema, handlePilot } from "./tools/pilot.js";
import { findSymbolSchema, handleFindSymbol } from "./tools/find-symbol.js";
import { outlineSchema, handleOutline } from "./tools/outline.js";

export function createServer(engine: IContextEngine, projectPath: string): McpServer {
  const server = new McpServer({
    name: "context-pilot",
    version: "0.7.1",
  });

  server.tool(
    "pilot",
    "Call this FIRST, before grepping or reading files for a task. Given the task in plain words, returns a " +
      "compact map: which files matter, in order, with their functions and line ranges, the code of the best " +
      "match, files that usually change with them and the tests to run. Then read only the ranges you need.",
    pilotSchema.shape,
    async ({ task, files, budget }) => {
      const result = await handlePilot({ task, files, budget }, engine, projectPath);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "find_symbol",
    "Where a function, class, method, type or constant is defined (file, lines, signature) and every file " +
      "that uses it, with line numbers. Use it instead of grep when you are looking for a name.",
    findSymbolSchema.shape,
    async ({ name, limit }) => {
      const result = await handleFindSymbol({ name, limit }, engine, projectPath);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "outline",
    "The functions, classes and methods of a file with their line ranges and signatures, without the bodies. " +
      "Use it instead of reading a whole file, then read only the lines you need.",
    outlineSchema.shape,
    async ({ files }) => {
      const result = await handleOutline({ files }, engine, projectPath);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "impact_of",
    "Given the files you are changing, returns other files likely affected, each with reasons: files that " +
      "historically change with them (git), files that import them (directly or transitively), and related tests. " +
      "Call it before finishing a change to check what you may have missed.",
    impactOfSchema.shape,
    async ({ files, limit, depth }) => {
      const result = await handleImpactOf({ files, limit, depth }, engine, projectPath);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "check_change",
    "Reads the current uncommitted changes from git (or a branch vs its base) and returns files that are likely " +
      "missing from the change: files that usually change together with the edited ones, their dependents and " +
      "related tests. Call it when you think a change is done, before committing.",
    checkChangeSchema.shape,
    async ({ staged, base, min_score, limit }) => {
      const result = await handleCheckChange({ staged, base, min_score, limit }, engine, projectPath);
      return { content: [{ type: "text", text: result }] };
    }
  );

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
