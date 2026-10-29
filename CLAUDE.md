# context-pilot — Claude Code Instructions

## Project overview
Pilots a coding agent's context: before it explores, a map of where to look for a task (files, symbols with line
ranges, related files, tests); after it edits, what else usually changes. Symbol index + git co-changes + import
graph. Any agent (Claude Code, Codex, Cursor, Gemini CLI, Copilot) through hooks and MCP. 100% local.

**Repo:** https://github.com/diegoalvarezf/context-pilot
**Stack:** TypeScript/Node.js 22+ — everything is TypeScript, no Python, no embeddings

## Architecture

```
packages/
├── engine/        # context-pilot-engine — git co-change mining, indexer, import graph, SQLite storage
├── mcp-server/    # context-pilot-mcp-server — 5 MCP tools, bridges AI client ↔ engine
└── cli/           # context-pilot — setup, init, index, status, serve, impact, check, hook, co-changes, backtest
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
| `engine/src/history/diff.ts` | Read-only working-tree changes (`git diff --name-status` vs HEAD / index / merge-base + untracked) |
| `engine/src/history/backtest.ts` | Backtesting: pure replay (`backtestCoChanges`) + read-only git wrapper (`backtestRepo`) |
| `engine/src/indexer/indexer.ts` | Parses files with tree-sitter, stores chunks + `file_imports`; `scanImportGraph` is the DB-free variant |
| `engine/src/indexer/chunker.ts` | Chunks + `extractImports` (import/export-from/require/import(), Python, PHP use/require) |
| `engine/src/indexer/imports.ts` | `ImportResolver` — specifier → project file (`./x.js`→`x.ts`, index files, Python relative/absolute, PHP namespaces) |
| `engine/src/impact/impact.ts` | Pure impact scoring: co-changes + dependents + dependencies + tests, noisy-OR, reasons |
| `engine/src/graph/graph.ts` | `DiGraph` — subgraph traversal, shortest paths |
| `engine/src/symbols/extract.ts` | Symbol defs (kind, parent, lines, signature, exported) and name uses per file, from tree-sitter |
| `engine/src/pilot/search.ts` | Text search over symbol names and paths: identifier-aware terms, idf, coverage (confidence) |
| `engine/src/pilot/pilot.ts` | Pure ranking (search hits + impact, noisy-OR) and the map composed within a token budget |
| `engine/src/pilot/bench.ts` | `bench`: replays commits (message = task) — recall of edited files and tokens vs grep + full reads |
| `cli/src/agents.ts` | Hook input parsing and reply formats per agent; `searchedName` for grep / rg in shell commands |
| `cli/src/agent-config.ts` | Pure add/remove of our hooks, MCP entries, Codex TOML block and AGENTS.md block per agent |
| `cli/src/commands/on.ts` | `on <prompt|search|edit|stop> --hook --agent <a>`: the one hook entry point; session state in tmpdir; `respond` returns an `Outcome` (text or silence + reason) and every call is traced |
| `cli/src/trace.ts` | Trace: `writeTrace` (JSONL, rotation, never throws), `summarize`, transcript parsing (`toolCallsOf`) and `usefulness` (suggested files the agent opened or changed in its next 20 tool calls) |
| `cli/src/commands/trace.ts` | `trace [--since] [-p] [--follow]`; skips `doctor`'s own calls |
| `cli/src/doctor.ts`, `cli/src/commands/doctor.ts` | `doctor`: pure judgments + I/O (global install / dev link, plugin registry, hooks per agent, index, trace errors, runs the prompt hook and an MCP handshake) |
| `engine/src/pilot/lang.ts` | Task terms in Spanish → English identifiers: dictionary (a `Map`, never an object: `constructor`!), accent folding, inflections |
| `engine/src/indexer/parse.ts`, `parse-child.ts` | Parse a file into chunks + symbols; Swift/C# on Node 25+ go to one child Node with `--liftoff-only` |
| `engine/src/storage/sqlite.ts` | `node:sqlite` — schema in `schema.ts`, queries |
| `mcp-server/src/server.ts` | `createServer(engine, projectPath)` — registers the MCP tools |
| `mcp-server/src/tools/*.ts` | One file per tool |
| `cli/src/index.ts` | Entry: installs warning filter, then dynamically imports `main.ts` |
| `cli/src/hooks.ts` | Pure helpers: add/remove our marked block in a git hook script, our Stop hook in Claude settings |
| `cli/src/commands/setup.ts` | `setup`: init + index + `installHooks` + `claude mcp add -s local` (removes an older entry first) |
| `cli/src/commands/hook.ts` | `hook install/uninstall`: pre-commit (`git rev-parse --git-path hooks`) + `.claude/settings.local.json` |

## Co-change model
- Commits newest-first, no merges; commits touching > 30 files (after ignores) are skipped as bulk changes
- Ignored: lockfiles, build output, `*.min.*`, `*.map`, snapshots, changelogs (`defaultIgnore`)
- Renames: older commits are attributed to the current path
- Weights: `2^((ts - DECAY_EPOCH) / 180 days)` — fixed epoch, so stored sums stay valid across incremental runs
- confidence(A→B) = wsupport(A,B) / wcommits(A) × n / (n + shrinkage), n = commits of A; multiple sources combine with noisy-OR (`max` / `mean` available)
- Defaults: `minSupport` 1, `minConfidence` 0.1, `shrinkage` 1 (so "1 of 1 commits" scores 50%, not 100%) (`DEFAULT_MIN_SUPPORT` / `DEFAULT_MIN_CONFIDENCE` in `cochange.ts`)
- Incremental only on fast-forward without renames; otherwise full re-mine

## Backtesting
- Newest N commits (default 200) are the test set; older ones train the model. Each test commit is predicted
  only from strictly older commits; with walk-forward (default) it is added to the model after being evaluated
- Queries use paths as they were before the commit (rename old name); added files are excluded from queries and
  targets (unpredictable by construction); bulk commits (> 30 files) and commits with < 2 eligible files are skipped
- `-q 1`: each file of the commit is queried alone; `-q n`: the first n files together. Metrics are averaged per
  commit, then across commits: precision@k (over queries with ≥1 prediction), recall@k, hit-rate@k, coverage
- `--calibrate`: also buckets every prediction by strongest-signal weight (what `check` thresholds on) and reports
  precision per bucket and per threshold, plus the share of commits that would get (correct) alerts

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

## MCP Tools

| Tool | Handler |
|------|---------|
| `impact_of` | `mcp-server/src/tools/impact-of.ts` |
| `check_change` | `mcp-server/src/tools/check-change.ts` |
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
pnpm test          # run all tests (vitest, engine and cli packages)
```

## Impact model (phase 3)
- Signals per candidate, combined with noisy-OR; strongest signal kept per (kind, changed file):
  co-change confidence; dependent (imports a changed file) 0.15, × 0.4 per extra hop, up to depth 2;
  dependency (imported by a changed file) 0 = off; test (named after, or directly importing, a changed file) 0.3
- Hub damping: dependents of a file with > 8 importers are scaled by sqrt(8 / importers)
- Weights live in `IMPACT_WEIGHTS` and are priors: `backtest --with-graph` uses today's graph for past commits
  (mild leak), so use it to compare configurations, not as an absolute number
- Calibration on expressjs/express (2026-10-15, HEAD a419aa73, `-t 500`, 201 commits evaluated):

  | config | P@5 | R@5 | Hit@5 | P@10 | R@10 | Hit@10 |
  |---|---|---|---|---|---|---|
  | co-changes only (minSupport 1, shrinkage 1) | 35.4% | 56.5% | 63.3% | 34.4% | 59.4% | 65.9% |
  | co-changes, minSupport 2 | 38.4% | 54.1% | 60.8% | 38.0% | 55.9% | 62.5% |
  | + graph, old priors (dep 0.45, test 0.6, dependency 0.1) | 32.2% | 55.8% | 62.7% | 30.9% | 60.1% | 67.0% |
  | + graph, current (dep 0.15, test 0.3, dependency 0) | 34.3% | 56.5% | 63.4% | 33.2% | 60.5% | 67.1% |

  Before ignoring `History.md` the numbers were inflated (~44% P@5, ~80% Hit@5): release-notes files are now in
  `defaultIgnore`. Takeaways: git co-changes carry most of the signal; the import graph adds a little recall@10 and
  answers files without history, at a small precision cost; the "dependency" signal only hurt precision. With an
  import graph from today the graph numbers are slightly optimistic. Repeat on a TS/Python repo before trusting more.
- Check (phase 4, `checkChange`): changed files = `git diff` vs HEAD (or `--cached`, or merge-base with `--base`)
  + untracked; renamed-away and deleted paths are queried too; ignored files dropped; > 30 files = skipped as bulk.
  Reports impact results not in the change whose *strongest single signal* ≥ `minScore` (0.6) — the noisy-OR score
  saturates when many files change, so it only sorts
- Check threshold calibration (2026-10-15, `backtest -t 500 --with-graph --calibrate`): every impact prediction of a
  query is kept with its strongest-signal weight; precision = share that were in the commit; "alerted" / "hit" =
  share of evaluated commits with ≥ 1 prediction / ≥ 1 correct prediction at that threshold (any query of the commit).
  Precision counts all predictions, not only the top 10 `check` prints. Repos: expressjs/express (JS, a419aa73,
  201 commits evaluated), colinhacks/zod (TS, 680d19f7, 314), sindresorhus/ky (TS, 3541888, 295; only 92 training
  commits). `-q 1` (one file edited so far):

  | ≥ min-score | express P / alerted / hit | zod P / alerted / hit | ky P / alerted / hit |
  |---|---|---|---|
  | 0.3 (old default) | 35.7% / 94.5% / 73.1% | 31.5% / 97.8% / 80.6% | 36.1% / 99.7% / 93.2% |
  | 0.4 | 38.8% / 88.6% / 69.2% | 42.3% / 93.3% / 75.8% | 48.3% / 98.0% / 88.8% |
  | 0.5 | 42.3% / 84.1% / 65.7% | 45.5% / 87.6% / 72.0% | 52.2% / 96.9% / 83.4% |
  | **0.6 (default)** | 47.6% / 76.6% / 61.2% | 64.0% / 72.3% / 58.6% | 59.6% / 85.8% / 72.2% |
  | 0.7 | 51.2% / 68.7% / 55.2% | 73.5% / 52.5% / 44.6% | 65.6% / 70.8% / 60.7% |
  | 0.8 | 47.0% / 54.7% / 44.8% | 76.5% / 39.2% / 33.8% | 75.1% / 57.6% / 48.5% |

  `-q 2` (two files edited) is harsher: at 0.6 precision is 27% (express), 52% (zod), 26% (ky), alerting on 38–55%
  of commits. Per-bucket precision rises with weight on the TS repos (zod 0.1–0.2: 8%, 0.6–0.7: 54%, 0.9–1.0: 85%);
  on express it is noisy and dips at 0.9–1.0 (33%). 0.6 is the knee: ~50–65% precision while still alerting on
  ~3/4 of commits. Side effect: structural signals alone (dependent ≤ 0.15, test 0.3) can no longer trigger `check`,
  so it is effectively co-change-only — a file without history never alerts. Run `backtest --calibrate` on your
  own repo and pass `--min-score` if it behaves differently
- Project ids: `projectId()` normalizes the root path (resolve, forward slashes, lower case on Windows)

## Current status
- Done: phase 0 (cleanup), phase 1 (git co-changes), phase 5 (backtesting), phase 3 (impact engine: `impact_of`
  MCP tool, `context-pilot impact`, file-level import graph with better resolution, `backtest --with-graph`),
  phase 4 (`check_change` MCP tool, `context-pilot check` with `--staged` / `--base` / `--strict`; threshold
  calibrated with `backtest --calibrate`), hooks (`context-pilot hook install [--strict] [--claude]`).
- Install: `npx context-pilot@latest setup` (README leads with it; `npm i -g` + `setup` for faster hooks). Packages publish
  with the same version (cli/engine/mcp-server, `workspace:*` pinned by `pnpm publish`); `files: ["dist"]`; cli
  copies the root README at `prepack`. npm versions 0.3.0, 1.0.0, 1.0.1 were used and unpublished: never reuse them.
- Hooks: commands use absolute node + CLI paths (work without PATH; re-run install after moving the CLI); when
  run from the npx cache they use `npx -y context-pilot@<version>` instead (`launcherArgv` in `hook.ts`).
  Pre-commit warns (`|| true`) unless `--strict`. Claude Stop hook = `check --claude-hook`: reads stdin, does
  nothing when `stop_hook_active`, exits 2 with the list on stderr (fed back to Claude), any error → exit 0.
- Pilot (0.6.0): `symbols` / `symbol_refs` tables (by project + path), `pilot` / `find_symbol` / `outline` MCP tools
  and CLI commands, `ensureFresh` (index when stale; hooks use 30 min), indexing only git-tracked files, hooks for
  every agent through `on`, `setup` detecting agents, `AGENTS.md` block. `node:sqlite` in Node 22 has no FTS5, so
  search is in memory. Prompt hook (`mapForPrompt` in `engine/src/pilot/task.ts`, shared with `bench`) first screens
  the prompt (`screenPrompt`: pasted text, > 1500 chars or 25 lines, question without a change request and without
  identifiers, request for a text, only the repo's / tool's names), then answers only when confidence (idf coverage of
  the task by the top files) ≥ 0.3. The task searched is the whole prompt (in this repo, "pilot" is code).
- Bench (2026-10-29, text search only, budget 1500; `--expand` adds history but is optimistic):
  ky 100 commits: map has an edited file 89%, edited files found 48%, tokens saved 40% (expand: 92% / 67% / 43%);
  express 81: 57% / 46% / 36% (expand: 64% / 58% / 37%); context-pilot 19: 68% / 31% / 23% (expand: 52% recall, 31%).
  At confidence ≥ 0.3: ky hit 93% on 61% of tasks, express 63% on 24%.
- Plugin: hooks go through `on` (prompt, search, edit, stop), MCP server and skill pinned to the release. Bump `plugin/`
  (plugin.json, `.mcp.json`, hooks.json) and `.claude-plugin/marketplace.json` with every release. npm 0.6.0 of the
  engine got stuck in staging: 0.6.0 is unusable, never reuse it.
- 0.7.0: trace of every hook call (`~/.context-pilot/trace.jsonl` or `$CONTEXT_PILOT_HOME`, 5 MB rotation, no prompt
  text), `trace` (summary, `--follow`, share of suggestions used from the agent's transcript), `doctor`; Spanish tasks
  (`lang.ts`; bench `--tasks bench/tasks/*.es.json`): ky 66% → 94% hit / 35% → 54% recall / 37% → 69% answered,
  express 53% → 59% / 43% → 50% / 23% → 35%, English unchanged; Swift and C# symbols (grammars bundled in
  `engine/grammars`, ABI 14 for web-tree-sitter 0.24).
- Node 25: V8's Turboshaft wasm compiler dies ("Fatal process out of memory: Zone", exit 133) on the Swift / C#
  grammars; `--liftoff-only` avoids it but can't be set at runtime (`v8.setFlagsFromString` has no effect), hence the
  child process. Recheck on newer Node and drop the child when fixed.
- Dev link: a global `context-pilot` linked to this checkout makes `npx context-pilot@<same version>` (plugin hooks,
  MCP server) run `packages/cli/dist`: rebuild after every change or the user's live sessions break. `doctor` warns.
- 0.7.1: prompt screening (negatives silent 21/21 on ky, express, portfolio, context-pilot, from 15–20/21; real tasks
  answered unchanged); search hook only on Grep for Claude, and non-searches leave before git / engine / trace;
  doctor ignores the npx cache on PATH.
- Next: a control group for real sessions (same tasks with and without hooks); more task languages; Swift / C# in the
  import graph.
- Known: `check` threshold calibrated on JS + TS (express, zod, ky), not yet Python / PHP; the watcher does not
  rebuild `file_imports` (only a full `index` does); PHP namespace resolution needs an unambiguous path suffix.
