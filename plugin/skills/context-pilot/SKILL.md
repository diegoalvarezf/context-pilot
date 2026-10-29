---
name: context-pilot
description: "Where to look in this repo and what else a change should touch, from a code index and the repo's git history. Use before exploring code for a task (instead of grepping around), when looking for where a name is defined or used, before planning a change to existing files, and before saying a change is done."
---

# context-pilot

context-pilot indexes the code (every function, class and method with its lines and signature, and where each name is used) and learns from `git log` which files change together. It answers two questions: "where should I look for this task?" and "if I change these files, what else usually needs to change?"

The plugin already runs it for you:

- **On each task**, a hook may add a map: the files that matter, their functions with line ranges, related files and tests. Start from it: read only the line ranges you need instead of grepping and reading whole files. It only appears when the task clearly names code it can find.
- **Before a grep for a name**, a hook may add where that name is defined and used. If that answers your question, you don't need the grep's results.
- **After each edit**, a hook adds files that usually change with the one you edited. Treat it as a checklist: open each and decide whether it needs updating. Ignore it when the change clearly doesn't apply.
- **Before you stop**, a hook checks your uncommitted changes and sends back files that look forgotten. Review them, update what needs it, or say why none does.

## Tools

- `pilot` (task) — the map for a task, within a token budget. Call it first when the hook didn't add one, or with a more precise task or the files you know are involved.
- `find_symbol` (name) — where a function, class, method, type or constant is defined (lines, signature) and every file that uses it, with line numbers. Use it instead of grep for names.
- `outline` (files) — what a file contains, with line ranges, without the bodies. Use it instead of reading a whole file.
- `impact_of` (files) — what else is likely affected: co-changes, files that import them (direct and transitive) and related tests, with reasons. Use it on the files you plan to change, before editing.
- `check_change` — likely-missing files in the current working tree, the same check the Stop hook runs.
- `co_changes` (file) — only the git-history signal, with support and confidence.

The tools keep the index up to date on their own.

## Reading the results

- The percentage is how likely the other file is to change when yours does. Above ~60% is usually real; below ~40% is a hint at most.
- Files marked `[test]` are tests that cover the file: run or update them.
- No results for a file means it is new or rarely changed together with anything, not that it is safe.
- The map is a starting point from names and history, not a guarantee: when it doesn't fit the task, explore as usual.

For large changes (migrations, framework upgrades, renames across the codebase), use `impact_of` to split the work into batches of files that change together and to order them, then validate each batch with its tests. The `impact-reviewer` agent can do this check cheaply before you finish a plan.
