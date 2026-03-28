# context-pilot 🧠

> Intelligent context middleware for AI coding agents. MCP-compatible, 100% local, privacy-first.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCP Compatible](https://img.shields.io/badge/MCP-compatible-blue)](https://modelcontextprotocol.io)
[![Status: WIP](https://img.shields.io/badge/status-work--in--progress-orange)]()

---

## The Problem

When using Claude Code, Cursor, or any AI coding agent with local LLMs (Ollama, LM Studio), context fills up fast. The agent "forgets" important parts of your codebase, injects irrelevant snippets, and loses architectural decisions across sessions.

There's no universal layer that manages **what context to inject, when, and in what format**.

## The Solution

**context-pilot** is a middleware [MCP server](https://modelcontextprotocol.io) that sits between your AI client and your codebase:

- Builds a **local knowledge graph** of your project (files, functions, dependencies, architectural decisions)
- **Dynamically selects** the most relevant context fragments for each prompt using local embeddings
- Works as a **universal MCP server** — connects to any compatible client (Claude Code, Cursor, Continue.dev...)
- **Persistent memory** across sessions with local embeddings — nothing leaves your machine

```
┌─────────────┐     MCP      ┌──────────────────┐     IPC      ┌─────────────────┐
│  AI Client  │◄────────────►│  context-pilot   │◄────────────►│ Embedding Engine│
│(Claude Code)│              │   MCP Server     │              │    (Python)     │
└─────────────┘              └──────────────────┘              └─────────────────┘
                                      │                                  │
                                      └──────────┬───────────────────────┘
                                                 ▼
                                        ┌────────────────┐
                                        │  SQLite DB     │
                                        │  (local only)  │
                                        └────────────────┘
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `query_context` | Get the most relevant context for your current task |
| `index_project` | Index or re-index your codebase |
| `remember` | Persist architectural decisions across sessions |
| `get_graph` | Explore dependency graphs around a file or function |
| `search_code` | Semantic search across your codebase |

## Quick Start

```bash
# 1. Clone and setup
git clone https://github.com/diegoalvarezf/context-pilot.git
cd context-pilot
bash scripts/setup.sh

# 2. Initialize in your project
cd /path/to/your-project
context-pilot init

# 3. Index your codebase
context-pilot index

# 4. Add to Claude Code
claude mcp add context-pilot -- context-pilot serve --project . --watch

# 5. Check status anytime
context-pilot status
```

## Stack

- **TypeScript/Node.js** — MCP server, CLI, protocol handling
- **Python** — Embeddings (`sentence-transformers/all-MiniLM-L6-v2`), knowledge graph (`networkx`), code parsing (`tree-sitter`)
- **SQLite** — Local persistence, no external databases

## Supported Languages

- TypeScript / JavaScript
- Python
- Go *(planned)*
- Rust *(planned)*

## Roadmap

- [x] Project architecture
- [x] MCP server with 5 tools
- [x] Embedding engine (tree-sitter + sentence-transformers)
- [x] Knowledge graph (networkx)
- [x] Intelligent context ranking (semantic + graph + recency)
- [x] CLI (`init`, `index`, `status`, `serve`)
- [x] Incremental indexing + file watcher (`--watch`)
- [x] FAISS support for large projects (auto, >500 chunks)

## Contributing

This project is in early development. Contributions, ideas, and feedback are welcome — open an issue!

## License

MIT
