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
└── cli/           # context-pilot — init, index, status, serve, co-changes, backtest
parked/
└── ui-server/     # old web dashboard, excluded from the workspace (to be revived as impact visualizer)
```

### Key boundaries
- All logic lives in `context-pilot-engine` (`ContextEngine` class)
- MCP server and CLI only call `IContextEngine` methods — no direct DB/FS/git access
- Exception: `backtestRepo` (CLI `backtest`) is exported as a standalone, DB-free engine function. It must stay read-only on the analyzed repo (only `git rev-parse` / `git log`) and must not open the SQLite DB
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
| `engine/src/history/backtest.ts` | Backtesting: pure replay (`backtestCoChanges`) + read-only git wrapper (`backtestRepo`) |
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
- confidence(A→B) = wsupport(A,B) / wcommits(A); multiple sources combine with noisy-OR (`max` / `mean` available)
- Defaults: `minSupport` 1, `minConfidence` 0.1 (`DEFAULT_MIN_SUPPORT` / `DEFAULT_MIN_CONFIDENCE` in `cochange.ts`)

## Backtesting
- Newest N commits (default 200) are the test set; older ones train the model. Each test commit is predicted
  only from strictly older commits; with walk-forward (default) it is added to the model after being evaluated
- Queries use paths as they were before the commit (rename old name); added files are excluded from queries and
  targets (unpredictable by construction); bulk commits (> 30 files) and commits with < 2 eligible files are skipped
- `-q 1`: each file of the commit is queried alone; `-q n`: the first n files together. Metrics are averaged per
  commit, then across commits: precision@k (over queries with ≥1 prediction), recall@k, hit-rate@k, coverage

### Calibration on context-pilot itself (2026-10-15, HEAD f4e7890, 22 commits — very small sample)
Walk-forward over all 22 commits: 12 evaluated (9 with < 2 known files, 1 bulk: the refocus commit, 48 files).

| query files | combine | minSupport | P@5 | R@5 | Hit@5 | P@10 | R@10 | Hit@10 |
|---|---|---|---|---|---|---|---|---|
| 1 | — | 1 | 23.9% | 34.0% | 77.9% | 22.0% | 54.1% | 90.8% |
| 1 | — | 2 | 29.5% | 10.8% | 33.4% | 30.3% | 14.3% | 36.5% |
| 1 | — | 3 | 29.4% | 2.4% | 10.4% | 29.2% | 2.4% | 10.4% |
| 2 | noisy-or = max = mean | 1 | 24.0% | 32.1% | 80.0% | 21.3% | 48.5% | 100% |
| 2 | noisy-or = max = mean | 2 | 11.4% | 12.3% | 30.0% | 11.9% | 21.3% | 40.0% |
| 3 | noisy-or = max | 1 | 16.0% | 27.5% | 50.0% | 15.3% | 46.2% | 80.0% |
| 3 | mean | 1 | 18.0% | 32.5% | 60.0% | 15.3% | 46.2% | 80.0% |
| 3 | any | 2 | 10.6% | 15.0% | 30.0% | 9.7% | 27.5% | 40.0% |

Conclusions: `minSupport` 1 triples recall/hit-rate at a small precision cost → new default (was 2).
Combination methods are indistinguishable here (only 10 multi-file queries; `mean` wins by one commit at q=3),
so noisy-OR stays. With so little history these numbers are noisy: re-calibrate on a larger repo
(`context-pilot backtest <repo> --json`) before trusting them, especially `minSupport` (1 may be too noisy on big repos).
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
Refocused on change-impact analysis (merged in `master`).
- Done: phase 0 (removed embeddings, memories, session commands; UI parked), phase 1 (git co-change mining + `co_changes` tool/CLI)
  and phase 5 (backtesting: `context-pilot backtest`, calibration above).
- Next: phase 3 impact engine, phase 4 `impact_of` / `check_change` / `context-pilot check`, phase 2 symbol-level graph.
- Known: TS imports written as `./foo.js` don't resolve to `foo.ts` in the import graph yet; calibration was done on only
  22 commits — repeat it on a larger repo; the backtest does not yet measure the import graph (phase 3 should reuse it).
