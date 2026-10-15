Review the context-pilot codebase for clean architecture and potential issues.

Focus on:

1. **Boundary integrity** — all logic in `context-pilot-engine`; `mcp-server` and `cli` only call `IContextEngine` methods, never the DB, filesystem internals or git directly.

2. **Pure core** — mining and scoring (`history/cochange.ts`) must stay free of I/O so they remain unit-testable; git and SQLite access belong in `history/git.ts`, `history/miner.ts` and `storage/`.

3. **Tool handlers** — each tool in `mcp-server/src/tools/` is a pure function receiving `engine` and `projectPath`. No global state in handlers.

4. **SQLite schema** — foreign keys enforced, indices for frequent queries, incremental mining keeps stored sums consistent (fixed-epoch decay), full re-mine on renames/rewrites.

5. **Path handling** — paths stored project-relative with forward slashes; inputs normalized with `toProjectPath` (Windows backslashes, absolute paths, subdirectory projects via `git --relative`).

6. **Security** — no user code sent to external APIs; git is invoked with argument arrays (no shell); ignored paths cover build output and secrets.

For each issue found: show the file and line, explain the problem, and suggest the fix.
