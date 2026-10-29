---
name: context-pilot
description: "Find where to look for a task and what else a code change should touch, from the repo's code and git history. Use before planning a change to existing files, when refactoring, renaming or migrating code, and before saying a change is done."
---

# context-pilot

context-pilot indexes the repo's symbols and learns from `git log` which files change together, combined with the import graph and the tests that cover each file. It answers two questions: "where is the code for this task?" and "if I change these files, what else usually needs to change?"

The plugin already runs it for you:

- **When a task arrives**, a hook adds a short map of the files and symbols most likely involved, only when it is confident (otherwise it says nothing). Start there instead of searching blind.
- **When you search for a symbol** (Grep or a grep/rg command), a hook adds where it is defined, so you can read that range directly.
- **After each edit**, a hook adds a note listing files that usually change with the one you edited. Treat it as a checklist: open each file and decide whether it needs updating. Ignore it when the change clearly doesn't apply.
- **Before you stop**, a hook checks your uncommitted changes and sends back files that look forgotten. Review them, update what needs it, or say why none does.

Notes are not repeated within a session, and the index refreshes itself when it is older than 30 minutes.

## Tools

Call these MCP tools yourself when planning:

- `pilot` (task) — a map of where to look for a task: files and symbols ranked by relevance, within a token budget.
- `find_symbol` (name) — where a function, class or type is defined, with its line range.
- `outline` (file) — the symbols of a file with their line ranges and its size in tokens, to read only the part you need.
- `impact_of` (files) — what else is likely affected: co-changes, files that import them (direct and transitive) and related tests, with reasons. Use it on the files you plan to change, before editing.
- `co_changes` (file) — only the git-history signal, with support and confidence.
- `check_change` — likely-missing files in the current working tree, the same check the Stop hook runs.
- `index_project` — indexes code, symbols and the import graph. Run it once in a new repo; the hooks keep it fresh afterwards.

## Reading the results

- The percentage is how likely the other file is to change when yours does. Above ~60% is usually real; below ~40% is a hint at most.
- Files marked `[test]` are tests that cover the file: run or update them.
- No results for a file means it is new or rarely changed together with anything, not that it is safe.
- A large token count in `outline` is a hint to read ranges, not the whole file.

For large changes (migrations, framework upgrades, renames across the codebase), use `impact_of` to split the work into batches of files that change together and to order them, then validate each batch with its tests. The `impact-reviewer` agent can do this check cheaply before you finish a plan.
