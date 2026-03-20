# context-pilot — Claude Code Instructions

## Project overview
Intelligent context middleware for AI coding agents. MCP-compatible, 100% local, privacy-first.

**Repo:** https://github.com/sallyheller/context-pilot
**Stack:** TypeScript/Node.js (MCP server + CLI) + Python (embeddings + knowledge graph)

## Architecture

```
packages/
├── mcp-server/        # MCP server (TypeScript) — tools, bridge, storage
├── embedding-engine/  # Python engine — indexer, embedder, search, IPC server
└── cli/               # CLI (TypeScript) — init, status, serve commands
```

### Key boundaries
- TypeScript layer: MCP protocol, tool definitions, SQLite (memories), IPC client
- Python layer: code parsing (tree-sitter), embeddings (sentence-transformers), semantic search
- Communication: JSON-RPC over stdin/stdout with Content-Length framing (same as LSP)
- Persistence: `~/.context-pilot/db.sqlite` — never write project data elsewhere

## Code conventions
- TypeScript: strict mode, ES2022, Node16 module resolution
- Python: 3.11+, type hints required, ruff for linting (line-length 100)
- No comments on obvious code — only on non-trivial logic
- Tool handlers are pure functions that receive the bridge/db as arguments
- Never send user code to external APIs — everything runs locally

## MCP Tools
| Tool | Handler file |
|------|-------------|
| `query_context` | `mcp-server/src/tools/query-context.ts` |
| `index_project` | `mcp-server/src/tools/index-project.ts` |
| `remember` | `mcp-server/src/tools/remember.ts` |
| `get_graph` | `mcp-server/src/tools/get-graph.ts` |
| `search_code` | `mcp-server/src/tools/search-code.ts` |

## IPC Protocol
Requests/responses use Content-Length framing:
```
Content-Length: N\r\n\r\n{"id":1,"method":"search","params":{...}}
```
Python methods: `index`, `search`, `status`, `graph` (Phase 3)

## Current phase
Phase 4 — CLI commands (init, status, serve)

## Commands
```bash
pnpm install          # install TS dependencies
pnpm build            # compile all TypeScript
pnpm dev              # run mcp-server in watch mode
pip install -e packages/embedding-engine  # install Python deps
```
