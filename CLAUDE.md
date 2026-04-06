# context-pilot — Claude Code Instructions

## Project overview
Intelligent context middleware for AI coding agents. MCP-compatible, 100% local, privacy-first.

**Repo:** https://github.com/diegoalvarezf/context-pilot
**Stack:** TypeScript/Node.js 22+ — everything is TypeScript, no Python

## Architecture

```
packages/
├── engine/        # @context-pilot/engine — indexer, embedder, graph, search, SQLite storage
├── mcp-server/    # MCP server — 5 tools, bridges AI client ↔ engine
├── cli/           # CLI — init, index, status, serve commands
└── embedding-engine/  # OBSOLETE — Python engine, replaced by packages/engine
```

### Key boundaries
- All logic lives in `@context-pilot/engine` (ContextEngine class)
- MCP server imports `IContextEngine` and calls its methods — no direct DB/FS access
- CLI bootstraps `ContextEngine` + `McpServer` and wires them together
- Persistence: `~/.context-pilot/db.sqlite` — never write project data elsewhere
- Never send user code to external APIs — everything runs locally

## Core classes & files

| File | Responsibility |
|------|---------------|
| `engine/src/engine.ts` | `ContextEngine` — main class, implements `IContextEngine` |
| `engine/src/types.ts` | All shared TypeScript interfaces |
| `engine/src/indexer/indexer.ts` | Parses files with tree-sitter, stores chunks + graph edges |
| `engine/src/embedder/embedder.ts` | `@huggingface/transformers` ONNX pipeline (`all-MiniLM-L6-v2`, 384 dims) |
| `engine/src/search/search.ts` | Cosine similarity semantic search |
| `engine/src/graph/graph.ts` | `DiGraph` — directed graph, subgraph traversal, shortest-path |
| `engine/src/storage/sqlite.ts` | `node:sqlite` (built-in) — schema, queries, blob encoding |
| `mcp-server/src/server.ts` | `createServer(engine, projectPath)` — registers all 5 MCP tools |
| `mcp-server/src/tools/*.ts` | One file per tool: query-context, index-project, remember, get-graph, search-code |
| `cli/src/commands/*.ts` | init, index, status, serve |

## MCP Tools

| Tool | Handler |
|------|---------|
| `query_context` | `mcp-server/src/tools/query-context.ts` |
| `index_project` | `mcp-server/src/tools/index-project.ts` |
| `remember` | `mcp-server/src/tools/remember.ts` |
| `get_graph` | `mcp-server/src/tools/get-graph.ts` |
| `search_code` | `mcp-server/src/tools/search-code.ts` |

## Code conventions
- TypeScript strict mode, ES2022, Node16 module resolution
- No comments on obvious code — only on non-trivial logic
- Tool handlers are pure functions that receive `engine` + `projectPath` as arguments
- `ContextEngine` uses in-memory caches (per project) for embeddings and graph — invalidate on re-index

## Commands
```bash
pnpm install       # install all dependencies (workspaces)
pnpm build         # compile all packages (pnpm -r build)
pnpm dev           # run mcp-server in watch mode
pnpm test          # run all tests
```

## Current status
MVP funcional. Stack 100% TypeScript. Pendiente: tests de integración, publicación npm.
