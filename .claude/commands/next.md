Show the current development status of context-pilot and start the next pending task.

Steps:
1. Read `CLAUDE.md` ("Current status") to get the current phase
2. Read the relevant source files to understand what's already implemented
3. Identify the next concrete task based on the refocus roadmap:
   - Phase 5: backtesting — replay past commits, give the model one file, measure precision/recall@k of the rest
   - Phase 3: impact engine — combine co-changes, direct/transitive dependents and related tests, each result with reasons
   - Phase 4: `impact_of` / `check_change` MCP tools and `context-pilot check` (staged diff, usable as pre-commit or agent hook)
   - Phase 2: symbol-level references with tree-sitter ("who calls this function")
4. Show a one-paragraph summary of what's done and what's next
5. Ask the user if they want to proceed, then implement the next task

Always update `CLAUDE.md` current status when a phase is completed.
