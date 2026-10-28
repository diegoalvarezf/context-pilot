---
name: context-pilot
description: "Find what else a code change should touch, from the repo's git history and imports. Use before planning a change to existing files, when refactoring, renaming or migrating code, and before saying a change is done."
---

# context-pilot

context-pilot learns from `git log` which files change together, and combines it with the import graph and the tests that cover each file. It answers: "if I change these files, what else usually needs to change?"

The plugin already runs it for you:

- **After each edit**, a hook adds a note listing files that usually change with the one you edited. Treat it as a checklist: open each file and decide whether it needs updating. Ignore it when the change clearly doesn't apply.
- **Before you stop**, a hook checks your uncommitted changes and sends back files that look forgotten. Review them, update what needs it, or say why none does.

## Tools

Call these MCP tools yourself when planning:

- `impact_of` (files) — what else is likely affected: co-changes, files that import them (direct and transitive) and related tests, with reasons. Use it on the files you plan to change, before editing.
- `co_changes` (file) — only the git-history signal, with support and confidence.
- `check_change` — likely-missing files in the current working tree, the same check the Stop hook runs.
- `index_project` — builds the import graph. Run it once in a new repo; without it you only get the history signal.

## Reading the results

- The percentage is how likely the other file is to change when yours does. Above ~60% is usually real; below ~40% is a hint at most.
- Files marked `[test]` are tests that cover the file: run or update them.
- No results for a file means it is new or rarely changed together with anything, not that it is safe.

For large changes (migrations, framework upgrades, renames across the codebase), use `impact_of` to split the work into batches of files that change together and to order them, then validate each batch with its tests. The `impact-reviewer` agent can do this check cheaply before you finish a plan.
