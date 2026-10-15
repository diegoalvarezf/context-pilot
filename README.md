# context-pilot

> Change-impact analysis for AI coding agents.
> **"You changed X — here's what else usually changes with it, and why."**
> MCP-compatible · 100% local · works on any language git can track

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCP Compatible](https://img.shields.io/badge/MCP-compatible-blue)](https://modelcontextprotocol.io)
[![Node.js 22+](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)
[![Status: Alpha](https://img.shields.io/badge/status-alpha-orange)]()

**Works with:** Claude Code · Cursor · Continue.dev · Zed · any MCP client

---

## The problem

Coding agents are good at finding code: grep, LSP and file reads get them there.
What they can't see is **what your team's history knows**:

- every time someone touches `billing/invoice.ts`, they also update `templates/invoice.html` and a migration;
- `auth.ts` changes almost always come with a change to `auth.test.ts` and `middleware.ts`;
- the config file nobody imports, but that breaks production when you forget it.

None of that is in the import graph. It is in `git log`. So agents finish a change
and leave the "obvious" companion files untouched.

## What context-pilot does

It mines your repository's git history and learns which files change together
(**co-changes**), then answers one question for your agent or for you:

```
$ context-pilot co-changes src/auth.ts

   82%  test/auth.test.ts          last together 2026-09-30
          with src/auth.ts: 14/17 commits
   61%  src/middleware.ts          last together 2026-08-12
          with src/auth.ts: 9/17 commits
```

- **Support**: in how many past commits the files changed together.
- **Confidence**: how likely the other file is to change when yours does, weighted
  towards recent history (half-life of 180 days).
- Several changed files combine their evidence: a file tied to all of them ranks first.

`context-pilot impact` (MCP: `impact_of`) adds what the code itself says — files that
import yours, directly or a couple of hops away, and the tests that cover them:

```
$ context-pilot impact src/auth.ts

   87%  test/auth.test.ts  [test]
          test named after src/auth.ts
          changed together with src/auth.ts in 14 of 17 commits
   78%  src/middleware.ts
          changed together with src/auth.ts in 9 of 17 commits
          imports src/auth.ts
   18%  src/app.ts
          depends on src/auth.ts (2 imports away)
```

`context-pilot check` (MCP: `check_change`) does the same for what you have actually
changed: it reads your uncommitted changes from git and lists likely-affected files that
are *not* part of the change — the files you probably forgot:

```
$ context-pilot check

Checked 1 changed file.

You may also need to change:

   86%  src/types.ts
          changed together with src/engine.ts in 6 of 6 commits
```

It is deliberately quiet: a file is only reported when one signal on its own reaches
`--min-score` (default 0.6, where about half or more of the alerts were right in backtests). Use `--staged` in a pre-commit hook, `--base main` to check a
whole branch, and `--strict` to exit with code 1 when something looks missing.

To run it automatically:

```
context-pilot hook install            # git pre-commit: warns, never blocks
context-pilot hook install --strict   # blocks the commit (skip once with git commit --no-verify)
context-pilot hook install --claude   # also a Claude Code Stop hook: when Claude finishes,
                                      # likely-missing files are sent back to it to review
context-pilot hook uninstall
```

The pre-commit block is added next to any existing hook, never replacing it. The Claude Code hook
goes to `.claude/settings.local.json` (it holds paths on your machine) and only fires once per stop.

Noise is filtered out: merge commits, bulk commits (more than 30 files: formatting,
mass renames, vendoring), lockfiles, build output and changelogs. Renames are
followed, so history recorded under an old path counts for the current one.
Files that no longer exist are never suggested.

Everything runs locally. Nothing leaves your machine: no embeddings, no model
download, no API calls.

---

## Quick start

**Requirements:** Node.js 22+ and git.

```bash
npm install -g context-pilot

cd /path/to/your-project
context-pilot init      # first time only
context-pilot index     # parse sources + mine git history (incremental afterwards)

context-pilot co-changes src/some/file.ts
```

### From source

```bash
git clone https://github.com/diegoalvarezf/context-pilot.git
cd context-pilot
pnpm install && pnpm build
pnpm link -g ./packages/cli
```

---

## Add to your AI client

### Claude Code

```bash
claude mcp add context-pilot -- context-pilot serve --project . --watch
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "context-pilot": {
      "command": "context-pilot",
      "args": ["serve", "--project", ".", "--watch"]
    }
  }
}
```

### Continue.dev / Zed

Any MCP client works the same way: run `context-pilot serve --project <path>` over stdio.

---

## MCP tools

| Tool | When to use |
|------|-------------|
| `impact_of` | Before finishing a change: what else is likely affected — co-changes, importers (direct and transitive), related tests — each with reasons |
| `check_change` | When you think a change is done: reads the uncommitted diff (or a branch vs its base) and returns files likely missing from it, with reasons |
| `co_changes` | Only the git signal: which files usually change with the ones you touched? |
| `index_project` | At the start of a session or after pulling — re-parses sources and mines new commits |
| `get_graph` | Import graph around a file: what it depends on and what depends on it |

### `co_changes` response

```json
{
  "results": [
    {
      "path": "test/auth.test.ts",
      "score": 0.82,
      "last_changed_together": "2026-09-30",
      "reasons": [
        "changed together with src/auth.ts in 14 of 17 commits (recency-weighted confidence 82%)"
      ]
    }
  ],
  "unknown_files": []
}
```

`unknown_files` lists inputs with no history (new files, ignored files).

---

## CLI

| Command | What it does |
|---------|--------------|
| `context-pilot init [path]` | Create `.context-pilot/config.json` |
| `context-pilot index [path]` | Parse sources and mine git history (`--force` to rebuild) |
| `context-pilot impact <files...>` | Likely affected files with reasons: co-changes + import graph + tests (`--json`, `-n`, `-d` depth) |
| `context-pilot check` | Files likely missing from your uncommitted changes (`--staged`, `--base <ref>`, `--min-score`, `--strict`, `--json`) |
| `context-pilot hook install` / `uninstall` | Run `check` before each commit (`--strict` blocks) and, with `--claude`, when Claude Code finishes |
| `context-pilot co-changes <files...>` | Files that change together with the given ones (`--json`, `-n`, `--min-support`) |
| `context-pilot backtest [path]` | Replay past commits: how well co-changes predict the rest of each commit (precision/recall/hit-rate@k). Read-only, no `init` needed (`--test-commits`, `-k`, `--with-graph`, `--calibrate` for precision per signal strength, `--json`) |
| `context-pilot status [path]` | Index and history stats |
| `context-pilot serve [path]` | Start the MCP server (`--watch` keeps the import graph live) |

Mining is incremental: re-running only reads commits since the last run. History
rewrites (rebase, reset) and renames trigger a full re-mine automatically.

---

## Stack

| Layer | Technology |
|-------|-----------|
| MCP server | `@modelcontextprotocol/sdk` |
| History | `git log --name-status -M` — no libgit bindings |
| Code parsing | `web-tree-sitter` — WASM, no node-gyp |
| Storage | `node:sqlite` — built into Node.js 22, at `~/.context-pilot/db.sqlite` |
| Runtime | TypeScript / Node.js 22 |

---

## Roadmap

- [x] Git co-change mining — support, recency-weighted confidence, rename tracking, noise filters
- [x] `co_changes` MCP tool and CLI command
- [x] Import graph from source (TS/JS incl. `./x.js`→`x.ts`, re-exports, `require`; Python relative/absolute; PHP `use`/`require`)
- [x] Backtesting: measure how well co-changes predict the rest of real past commits (`context-pilot backtest`)
- [x] Impact engine: co-changes + dependents (direct + transitive) + related tests, with reasons (`impact_of`, `context-pilot impact`)
- [x] `check_change` tool and `context-pilot check`: files likely missing from your current change (pre-commit / agent hook)
- [x] Calibrate the `check` threshold with backtests (precision per score bucket)
- [x] Ready-made hooks: git pre-commit and Claude Code Stop (`context-pilot hook install`)
- [ ] Symbol-level references ("who calls this function")
- [ ] Impact visualizer (the old dashboard is parked in `parked/ui-server`)

---

## Contributing

Early stage. Issues, ideas and PRs are very welcome.

## License

MIT
