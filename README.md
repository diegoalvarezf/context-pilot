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

**Requirements:** Node.js 22.13+ and git.

### Claude Code plugin (recommended)

```bash
claude plugin marketplace add diegoalvarezf/context-pilot
claude plugin install context-pilot@context-pilot
```

Or in one step from inside Claude Code (2.1.275+): `/plugin install context-pilot --marketplace diegoalvarezf/context-pilot`.

The plugin brings everything, with no settings to edit:

- **After each edit**, a hook tells Claude which files usually change together with the one it just touched
  ("this file usually changes with `X.test.ts` and `config.ts`"). Each file is mentioned once per session.
- **Before Claude stops**, a hook checks the uncommitted changes and sends back files that look forgotten.
- The **MCP server** with all the tools below, and a **skill** that explains when to use them.
- An **`impact-reviewer` agent** on Haiku: a cheap second look at a plan or a diff before Claude closes it.

### Any project, any client

From your project's folder, with nothing to install first:

```bash
npx context-pilot@latest setup
```

That's it. `setup` indexes the code and git history, adds a pre-commit hook that warns about
files you probably forgot, and, if you use Claude Code, registers the MCP server and two hooks: one that
tells Claude what usually changes with each file it edits, and one that asks it to review likely-missing files when it finishes. Run it again any time; it never duplicates anything.
Use `--strict` to block commits instead of warning, `--no-claude` or `--no-hooks` to skip parts.

Hooks then start context-pilot through `npx` (a second or two per commit). For faster hooks, install it globally:

```bash
npm install -g context-pilot && context-pilot setup
```

To undo: `npx context-pilot@latest hook uninstall && claude mcp remove -s local context-pilot`.

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

Install the plugin (see [Quick start](#quick-start)), or let `context-pilot setup` configure it. By hand:

```bash
claude mcp add -s local context-pilot -- context-pilot serve .
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "context-pilot": {
      "command": "context-pilot",
      "args": ["serve", "."]
    }
  }
}
```

### Continue.dev / Zed

Any MCP client works the same way: run `context-pilot serve <path>` over stdio (`--watch` to re-index on file changes).

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
| `context-pilot setup [path]` | Everything at once: init, index, hooks, Claude Code MCP server (`--strict`, `--no-hooks`, `--no-claude`) |
| `context-pilot init [path]` | Create `.context-pilot/config.json` |
| `context-pilot index [path]` | Parse sources and mine git history (`--force` to rebuild) |
| `context-pilot impact <files...>` | Likely affected files with reasons: co-changes + import graph + tests (`--json`, `-n`, `-d` depth) |
| `context-pilot check` | Files likely missing from your uncommitted changes (`--staged`, `--base <ref>`, `--min-score`, `--strict`, `--json`) |
| `context-pilot hint <file>` | What usually changes together with a file you just edited; with `--claude-hook` it runs as a Claude Code PostToolUse hook (`--min-score`, `-n`) |
| `context-pilot hook install` / `uninstall` | Run `check` before each commit (`--strict` blocks) and, with `--claude`, add the Claude Code hooks (after each edit and on stop) |
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
- [x] Proactive hint after each edit (Claude Code PostToolUse hook, `context-pilot hint`)
- [x] Claude Code plugin: MCP server, hooks, skill and a Haiku `impact-reviewer` agent
- [ ] Measure the effect on agents: same tasks with and without context-pilot (tokens, forgotten files, fix-up rounds)
- [ ] Migration mode: plan large changes (e.g. PHP 7 → 8) in ordered batches of files that change together, each with its tests
- [ ] Learn from feedback: weigh hints by whether the agent acted on them
- [ ] Symbol-level references ("who calls this function")
- [ ] Impact visualizer (the old dashboard is parked in `parked/ui-server`)

---

## Contributing

Early stage. Issues, ideas and PRs are very welcome.

## License

MIT
