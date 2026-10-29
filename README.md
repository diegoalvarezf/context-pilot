# context-pilot

> Pilots your coding agent's context.
> **Before it greps around: "look here, at these lines". After it edits: "this usually changes too".**
> Works on its own · any agent · 100% local · any language git can track

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCP Compatible](https://img.shields.io/badge/MCP-compatible-blue)](https://modelcontextprotocol.io)
[![Node.js 22+](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)
[![Status: Alpha](https://img.shields.io/badge/status-alpha-orange)]()

**Works with:** Claude Code · Codex · Cursor · Gemini CLI · GitHub Copilot · any MCP client (Zed, Windsurf, Continue…)

---

## The problem

Coding agents spend a lot of their context finding their way: grep for a word, read a file whole to see
what's in it, grep again, read another file. Most of what they read is not what they needed.

And then they still miss what **your team's history knows**:

- every time someone touches `billing/invoice.ts`, they also update `templates/invoice.html` and a migration;
- `auth.ts` changes almost always come with a change to `auth.test.ts` and `middleware.ts`.

None of that is in the import graph. It is in `git log`.

## What context-pilot does

It indexes your code (every function, class and method, with its lines and signature, and where each name
is used) and learns from git history which files change together. Then it steps in by itself at four moments:

| When | What the agent gets |
|------|---------------------|
| You give it a task | A **map**: the files that matter, in order, their functions with line ranges, the code of the best match, files that usually change with them and the tests to run. Only when it's confident the task is about code it can find: never for pasted text, logs or diffs, questions and chat without a change request, requests for a text ("write me a prompt…"), or a prompt whose only words are the repo's or the tool's name. |
| It's about to grep for a name (Grep tool) | Where that name is **defined and used**, with line numbers |
| It edits a file | What **usually changes together** with that file |
| It says it's done | Files that **look forgotten**, so it reviews them before stopping |

Each thing is said once per session, and anything unexpected means silence: it never gets in the agent's way.

```
$ context-pilot pilot "the retry delay should respect the Retry-After header"

source/core/retry-timing.ts — defines RetryTimingHeader, getRetryTimingHeader, calculateRetryTimingDelay
    L11-14  type RetryTimingHeader =
    L25-49  export const getRetryTimingHeader = (headers: Headers): RetryTimingHeader | undefined
    L151-173  export const calculateRetryTimingDelay = ({value, allowTimestamp}: RetryTimingHeader): number | undefined
    …
source/types/hooks.ts — defines AfterResponseHook, BeforeRetryUpdate; changed together with test/hooks.ts in 25 of 89 commits
    …
Also related: source/core/Ky.ts, source/utils/delay.ts
Tests to run or update: test/retry.ts, test/hooks.ts
Read only the line ranges you need.
```

### Does it save tokens?

Measured, not guessed: `context-pilot bench` replays past commits, using each commit message as the task and the
files it modified as the answer. **Without** context-pilot, the agent greps the task's words and reads the files
it edits in full. **With** it, the agent gets the map, reads only the matched line ranges, and greps and reads in
full only what the map missed.

| Repo | Commits | Map contains an edited file | Edited files in the map | Tokens saved |
|---|---|---|---|---|
| sindresorhus/ky (TS) | 100 | 89% | 48% | **40%** |
| expressjs/express (JS) | 81 | 57% | 46% | **36%** |
| context-pilot itself (TS) | 19 | 68% | 31% | **23%** |

**Tasks in Spanish** (or written in another language than the code) match through a local dictionary of
programming words: on ky, "que el retraso de los reintentos respete la cabecera de espera del servidor" leads with
`#calculateRetryDelay` and `#retry`. With the same commits translated to Spanish (`bench/tasks/*.es.json`):

| Repo | Map contains an edited file | Edited files in the map | Tokens saved | Tasks the hook answers |
|---|---|---|---|---|
| ky, Spanish tasks — before | 66% | 35% | 27% | 37% |
| ky, Spanish tasks — now | **94%** | **54%** | **45%** | **69%** |
| express, Spanish tasks — before | 53% | 43% | 31% | 23% |
| express, Spanish tasks — now | **59%** | **50%** | **36%** | **35%** |

On prompts that aren't code tasks (`bench/tasks/negatives.json`: two pasted reports, "pásame el prompt para el chat de
context-pilot", questions, chat, a log, a diff) the prompt hook now stays silent on 21 of 21 in ky, express, this repo
and a Next.js portfolio, up from 15–20 of 21 in 0.7.0, while answering exactly the same real tasks as before.

English results are unchanged. On ky the Spanish run edges past the English one because each translated word also
tries its synonyms (`respuesta` → `response`, `res`).

Text search only, 1,500-token maps. Adding git history (`bench --expand`) raises the share of edited files found to
52–67% and the savings to 31–43%, but that run is optimistic: today's history already contains the commit being
tested. Commit messages are a hard, terse version of a real task; run `context-pilot bench` on your own repo.

`context-pilot check` (MCP: `check_change`) still does what it did from the start: it reads your uncommitted changes
and lists likely-affected files that are *not* part of the change. A file is only reported when one signal on its
own reaches `--min-score` (default 0.6, where about half or more of the alerts were right in backtests). It also
runs as a git pre-commit hook, so it helps without any agent.

Languages: TypeScript, JavaScript, Python, PHP, Swift and C# for symbols; HTML and CSS are indexed as files. The
import graph covers TS/JS, Python and PHP; the git history signal works for any file.

Noise is filtered out: merge commits, bulk commits (more than 30 files), lockfiles, build output and changelogs.
Renames are followed. Only what git tracks is indexed (`.gitignore` is respected). Nothing leaves your machine:
no embeddings, no model download, no API calls.

---

## Quick start

**Requirements:** Node.js 22.13+ and git. From your project's folder:

```bash
npx context-pilot@latest setup
```

That's all you do. `setup` indexes the code and git history, finds which agents you use, and sets up each one:

| Agent | Map on each task | Before a grep | After an edit | When it finishes | MCP server |
|---|---|---|---|---|---|
| Claude Code | ✓ | ✓ | ✓ | ✓ | ✓ (`claude mcp add -s local`) |
| Codex | ✓ | | ✓ | ✓ | ✓ (`.codex/config.toml`) |
| Gemini CLI | ✓ | | ✓ | ✓ | ✓ (`.gemini/settings.json`) |
| Cursor | | | ✓ | ✓ | ✓ (`.cursor/mcp.json`) |
| GitHub Copilot (CLI, VS Code) | | | ✓ | ✓ | ✓ (`.vscode/mcp.json`, `.github/mcp.json`) |
| Zed, Windsurf, Continue… | via `AGENTS.md` | | | | add `context-pilot serve` yourself |

Empty cells are events the agent has no way to receive (yet). It also adds a git pre-commit hook that warns about
forgotten files (`--strict` blocks the commit) and a short section to `AGENTS.md` telling agents to use the tools.
Run it again any time; it never duplicates anything. Choose agents with `--agent claude,cursor`, skip parts with
`--no-hooks` or `--no-claude`. To undo: `npx context-pilot@latest hook uninstall`.

Agent hooks and MCP entries hold absolute paths on your machine, except Copilot's files under `.github/` and
`.vscode/` (meant to be committed), which run `context-pilot` or a pinned `npx`. For faster hooks install it globally:

```bash
npm install -g context-pilot && context-pilot setup
```

Codex, Cursor and Copilot hooks follow their documentation as of October 2026 but are less tested than Claude
Code's; Cursor in particular has open reports of hook context not reaching the model.

### Claude Code plugin

```bash
claude plugin marketplace add diegoalvarezf/context-pilot
claude plugin install context-pilot@context-pilot
```

The same hooks and MCP server, plus a skill on when to use the tools and an `impact-reviewer` agent on Haiku:
a cheap second look at a plan or a diff.

### Is it working?

```bash
context-pilot doctor            # install, hooks per agent, index, and runs the hook and the MCP server like the agent does
context-pilot trace --since 7d  # what the hooks did: spoke, stayed silent (and why), failed, how fast
context-pilot trace --follow    # watch the calls live while you use your agent
```

Every hook call adds a line to `~/.context-pilot/trace.jsonl` (or `$CONTEXT_PILOT_HOME`): agent, event, project,
duration, result and reason, the map's confidence and the files it suggested. Never your prompt, only its length and a
hash; the file rotates at 5 MB. `trace` also reads the agent's transcript to tell you how many of the suggested files
the agent then opened or changed in its next 20 tool calls, per event. Some of them it would have opened anyway, so read
it as an upper bound, but a number near zero means the hook is noise.

### From source

```bash
git clone https://github.com/diegoalvarezf/context-pilot.git
cd context-pilot
pnpm install && pnpm build
pnpm link -g ./packages/cli
```

---

## MCP tools

| Tool | When to use |
|------|-------------|
| `pilot` | First, before exploring for a task: a compact map of where to look, within a token budget |
| `find_symbol` | Instead of grep for a name: where it's defined (lines, signature) and every file that uses it |
| `outline` | Instead of reading a whole file: its functions, classes and methods with line ranges |
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
| `context-pilot setup [path]` | Everything at once: index, then hooks and MCP server for every agent found (`--agent`, `--strict`, `--no-hooks`, `--no-claude`) |
| `context-pilot pilot "<task>"` | The map for a task (`-f` files you know are involved, `-b` budget, `--json`) |
| `context-pilot find <name>` | Where a symbol is defined and used (`--json`) |
| `context-pilot outline <files...>` | Functions and classes of a file with line ranges (`--json`) |
| `context-pilot bench [path]` | Replay past commits to measure how often the map finds the edited files and the tokens it saves (`-n`, `-b`, `--expand`, `--tasks <file>` with other task texts, e.g. translated, `--negatives <file>` with prompts that aren't tasks, to check the hook stays silent, `--json`) |
| `context-pilot trace` | What the hooks did and whether agents used their suggestions (`--since 7d`, `-p <project>`, `--follow`, `--json`) |
| `context-pilot doctor [path]` | Checks install, hooks per agent, index and recent errors, and runs the prompt hook and an MCP handshake (`--skip-run`) |
| `context-pilot on <event> --hook --agent <a>` | Hook entry point agents call (`prompt`, `search`, `edit`, `stop`); reads the agent's JSON on stdin |
| `context-pilot init [path]` | Create `.context-pilot/config.json` |
| `context-pilot index [path]` | Parse sources and mine git history (`--force` to rebuild) |
| `context-pilot impact <files...>` | Likely affected files with reasons: co-changes + import graph + tests (`--json`, `-n`, `-d` depth) |
| `context-pilot check` | Files likely missing from your uncommitted changes (`--staged`, `--base <ref>`, `--min-score`, `--strict`, `--json`) |
| `context-pilot hint <file>` | What usually changes together with a file you just edited; with `--claude-hook` it runs as a Claude Code PostToolUse hook (`--min-score`, `-n`) |
| `context-pilot hook install` / `uninstall` | Run `check` before each commit (`--strict` blocks) and add agent hooks (`--agent claude,codex,cursor,gemini,copilot`); uninstall removes them all |
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
- [x] Trace every hook call (`trace`, `trace --follow`) and how many suggestions agents used; `doctor`
- [ ] Measure the effect on real agent sessions with a control group: same tasks with and without context-pilot (tokens, forgotten files, fix-up rounds)
- [ ] Migration mode: plan large changes (e.g. PHP 7 → 8) in ordered batches of files that change together, each with its tests
- [ ] Learn from feedback: weigh hints by whether the agent acted on them
- [x] Symbol index: definitions with line ranges and signatures, and where each name is used (`find_symbol`, `outline`)
- [x] The pilot: a map for a task before the agent explores (`pilot`), on its own on each task
- [x] Any agent: Codex, Cursor, Gemini CLI, GitHub Copilot hooks and MCP setup, `AGENTS.md`
- [x] `bench`: how often the map finds the edited files and how many tokens it saves
- [x] Tasks in Spanish over English identifiers (local dictionary; bench with translated tasks)
- [x] Swift and C# symbols
- [ ] More task languages, and Swift / C# in the import graph
- [ ] Impact visualizer (the old dashboard is parked in `parked/ui-server`)

---

## Contributing

Early stage. Issues, ideas and PRs are very welcome.

## License

MIT
