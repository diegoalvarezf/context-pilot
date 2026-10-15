# context-pilot — Claude Code Instructions

## Project overview
Change-impact analysis for AI coding agents: "you changed X — here's what else usually changes with it, and why".
Mines git history for co-changes and builds an import graph. MCP-compatible, 100% local.

**Repo:** https://github.com/diegoalvarezf/context-pilot
**Stack:** TypeScript/Node.js 22+ — everything is TypeScript, no Python, no embeddings

## Architecture

```
packages/
├── engine/        # context-pilot-engine — git co-change mining, indexer, import graph, SQLite storage
├── mcp-server/    # context-pilot-mcp-server — 3 MCP tools, bridges AI client ↔ engine
└── cli/           # context-pilot — init, index, status, serve, co-changes
parked/
└── ui-server/     # old web dashboard, excluded from the workspace (to be revived as impact visualizer)
```

### Key boundaries
- All logic lives in `context-pilot-engine` (`ContextEngine` class)
- MCP server and CLI only call `IContextEngine` methods — no direct DB/FS/git access
- Persistence: `~/.context-pilot/db.sqlite` — never write project data elsewhere
- Never send user code to external APIs — everything runs locally
- Workspace packages depend on each other with `workspace:*`

## Core files

| File | Responsibility |
|------|---------------|
| `engine/src/engine.ts` | `ContextEngine` — implements `IContextEngine`; `toProjectPath` normalizes input paths |
| `engine/src/types.ts` | Shared interfaces |
| `engine/src/history/git.ts` | Runs `git log --name-status -M --relative`, parses it (`parseGitLog`) |
| `engine/src/history/cochange.ts` | Pure aggregation: per-file/per-pair stats, rename resolution, noise filters, noisy-OR combination |
| `engine/src/history/miner.ts` | Full vs incremental mining, writes to SQLite |
| `engine/src/indexer/indexer.ts` | Parses files with tree-sitter, stores chunks + import edges |
| `engine/src/graph/graph.ts` | `DiGraph` — subgraph traversal, shortest paths |
| `engine/src/storage/sqlite.ts` | `node:sqlite` — schema in `schema.ts`, queries |
| `mcp-server/src/server.ts` | `createServer(engine, projectPath)` — registers the MCP tools |
| `mcp-server/src/tools/*.ts` | One file per tool |
| `cli/src/index.ts` | Entry: installs warning filter, then dynamically imports `main.ts` |

## Co-change model
- Commits newest-first, no merges; commits touching > 30 files (after ignores) are skipped as bulk changes
- Ignored: lockfiles, build output, `*.min.*`, `*.map`, snapshots, changelogs (`defaultIgnore`)
- Renames: older commits are attributed to the current path
- Weights: `2^((ts - DECAY_EPOCH) / 180 days)` — fixed epoch, so stored sums stay valid across incremental runs
- confidence(A→B) = wsupport(A,B) / wcommits(A); multiple sources combine with noisy-OR
- Incremental only on fast-forward without renames; otherwise full re-mine

## MCP Tools

| Tool | Handler |
|------|---------|
| `co_changes` | `mcp-server/src/tools/co-changes.ts` |
| `index_project` | `mcp-server/src/tools/index-project.ts` |
| `get_graph` | `mcp-server/src/tools/get-graph.ts` |

## Code conventions
- TypeScript strict mode, ES2022, Node16 module resolution
- No comments on obvious code — only on non-trivial logic
- Tool handlers are pure functions that receive `engine` + `projectPath` as arguments
- Keep mining/scoring logic pure (no I/O) so it stays unit-testable
- `ContextEngine` caches the graph per project — invalidate on re-index

## Commands
```bash
pnpm install       # install all dependencies (workspaces)
pnpm build         # compile all packages (pnpm -r build)
pnpm test          # run all tests (vitest, engine package)
```

## Current status
Refocus on impact analysis (branch `refocus/impact-analysis`).
- Done: phase 0 (removed embeddings, memories, session commands; UI parked) and phase 1 (git co-change mining + `co_changes` tool/CLI, tests).
- Next: phase 5 backtesting (predict the rest of past commits from one file; precision/recall@k), then phase 3 impact engine, phase 4 `impact_of` / `check_change` / `context-pilot check`, phase 2 symbol-level graph.
- Known: TS imports written as `./foo.js` don't resolve to `foo.ts` in the import graph yet; noisy-OR over-scores correlated sources (to calibrate with backtesting).
