import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { IContextEngine } from "context-pilot-engine";
import { coChangesSchema, handleCoChanges } from "./tools/co-changes.js";
import { impactOfSchema, handleImpactOf } from "./tools/impact-of.js";
import { checkChangeSchema, handleCheckChange } from "./tools/check-change.js";
import { indexProjectSchema, handleIndexProject } from "./tools/index-project.js";
import { getGraphSchema, handleGetGraph } from "./tools/get-graph.js";
import { pilotSchema, handlePilot } from "./tools/pilot.js";
import { findSymbolSchema, handleFindSymbol } from "./tools/find-symbol.js";
import { outlineSchema, handleOutline } from "./tools/outline.js";
import { usageStatsSchema, handleUsageStats } from "./tools/usage-stats.js";

function recordTelemetry(
  engine: IContextEngine,
  projectPath: string,
  tool: string,
  result: string,
  inputFiles?: string[]
): void {
  const responseTokens = Math.ceil(result.length / 4);
  let fullFilesTokens = 0;

  if (tool === "outline" || tool === "pilot" || tool === "find_symbol") {
    const candidates = new Set<string>();
    if (inputFiles) {
      for (const f of inputFiles) {
        if (typeof f === "string" && f.trim()) candidates.add(f.trim());
      }
    }

    const lines = result.split("\n");
    for (const line of lines) {
      const defMatch = line.match(/^defined:\s+([^\s:]+):/);
      if (defMatch) candidates.add(defMatch[1]);
      const useMatch = line.match(/^\s+([^\s:]+):/);
      if (useMatch) candidates.add(useMatch[1]);
      const pilotMatch = line.match(/^([^\s—]+)\s+—/);
      if (pilotMatch) candidates.add(pilotMatch[1]);
      const outlineMatch = line.match(/^([^\s(]+)\s+\(~/);
      if (outlineMatch) candidates.add(outlineMatch[1]);
    }

    const seenAbs = new Set<string>();
    for (const file of candidates) {
      try {
        const absFile = isAbsolute(file) ? file : resolve(projectPath, file);
        if (!seenAbs.has(absFile) && existsSync(absFile)) {
          seenAbs.add(absFile);
          const st = statSync(absFile);
          if (st.isFile()) {
            fullFilesTokens += Math.ceil(st.size / 4);
          }
        }
      } catch {
        // ignore errors reading file stats
      }
    }
  }

  const savedTokens = Math.max(0, fullFilesTokens - responseTokens);

  try {
    engine.recordUsage?.({
      projectPath,
      tool,
      responseTokens,
      fullFilesTokens,
      savedTokens,
    });
  } catch {
    // Non-blocking telemetry
  }
}

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
    async ({ task, files, budget, path }) => {
      const targetPath = path ?? projectPath;
      const result = await handlePilot({ task, files, budget, path }, engine, targetPath);
      recordTelemetry(engine, targetPath, "pilot", result, files);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "find_symbol",
    "Where a function, class, method, type or constant is defined (file, lines, signature) and every file " +
      "that uses it, with line numbers. Use it instead of grep when you are looking for a name.",
    findSymbolSchema.shape,
    async ({ name, limit, path }) => {
      const targetPath = path ?? projectPath;
      const result = await handleFindSymbol({ name, limit, path }, engine, targetPath);
      recordTelemetry(engine, targetPath, "find_symbol", result);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "outline",
    "The functions, classes and methods of a file with their line ranges and signatures, without the bodies. " +
      "Use it instead of reading a whole file, then read only the lines you need.",
    outlineSchema.shape,
    async ({ files, path }) => {
      const targetPath = path ?? projectPath;
      const result = await handleOutline({ files, path }, engine, targetPath);
      recordTelemetry(engine, targetPath, "outline", result, files);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "impact_of",
    "Given the files you are changing, returns other files likely affected, each with reasons: files that " +
      "historically change with them (git), files that import them (directly or transitively), and related tests. " +
      "Call it before finishing a change to check what you may have missed.",
    impactOfSchema.shape,
    async ({ files, limit, depth, path }) => {
      const targetPath = path ?? projectPath;
      const result = await handleImpactOf({ files, limit, depth, path }, engine, targetPath);
      recordTelemetry(engine, targetPath, "impact_of", result, files);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "check_change",
    "Reads the current uncommitted changes from git (or a branch vs its base) and returns files that are likely " +
      "missing from the change: files that usually change together with the edited ones, their dependents and " +
      "related tests. Call it when you think a change is done, before committing.",
    checkChangeSchema.shape,
    async ({ staged, base, min_score, limit, path }) => {
      const targetPath = path ?? projectPath;
      const result = await handleCheckChange({ staged, base, min_score, limit, path }, engine, targetPath);
      recordTelemetry(engine, targetPath, "check_change", result);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "co_changes",
    "Given the files you are changing, returns other files that historically change together with them " +
      "in this repo's git history, with how often and why. Call it before finishing a change to catch files " +
      "you may have forgotten (tests, configs, sibling modules, migrations).",
    coChangesSchema.shape,
    async ({ files, limit, min_support, path }) => {
      const targetPath = path ?? projectPath;
      const result = await handleCoChanges({ files, limit, min_support, path }, engine, targetPath);
      recordTelemetry(engine, targetPath, "co_changes", result, files);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "index_project",
    "Index the project: parses source files for the import graph and mines git history for co-changes. " +
      "Incremental and cheap to re-run; run it at the start of a session or after pulling new commits.",
    indexProjectSchema.shape,
    async ({ force, path }) => {
      const targetPath = path ?? projectPath;
      const result = await handleIndexProject({ force, path }, engine, targetPath);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "get_graph",
    "Get the import graph around a file or function: what it depends on and what depends on it.",
    getGraphSchema.shape,
    async ({ target, depth, direction, path }) => {
      const targetPath = path ?? projectPath;
      const result = await handleGetGraph({ target, depth, direction, path }, engine, targetPath);
      recordTelemetry(engine, targetPath, "get_graph", result);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "usage_stats",
    "Token savings telemetry: summary of tokens saved across tools and projects.",
    usageStatsSchema.shape,
    async ({ path }) => {
      const targetPath = path ?? projectPath;
      const result = await handleUsageStats({ path }, engine, targetPath);
      return { content: [{ type: "text", text: result }] };
    }
  );

  return server;
}
