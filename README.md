# context-pilot 🧠

> Intelligent context middleware for AI coding agents. MCP-compatible, 100% local, privacy-first.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCP Compatible](https://img.shields.io/badge/MCP-compatible-blue)](https://modelcontextprotocol.io)
[![Status: Beta](https://img.shields.io/badge/status-beta-orange)]()

---

## The Problem

When using Claude Code, Cursor, or any AI coding agent, context fills up fast. The agent "forgets" important parts of your codebase, injects irrelevant snippets, and loses architectural decisions across sessions.

There's no universal layer that manages **what context to inject, when, and in what format**.

## The Solution

**context-pilot** is a middleware [MCP server](https://modelcontextprotocol.io) that sits between your AI client and your codebase:

- Builds a **local knowledge graph** of your project (files, functions, dependencies, architectural decisions)
- **Dynamically selects** the most relevant context fragments for each prompt using local embeddings
- Works as a **universal MCP server** — connects to any compatible client (Claude Code, Cursor, Continue.dev...)
- **Persistent memory** across sessions — nothing leaves your machine

```
┌─────────────┐     MCP      ┌──────────────────────────────────┐
│  AI Client  │◄────────────►│         context-pilot            │
│(Claude Code)│              │  MCP Server + Embedding Engine   │
└─────────────┘              │  (TypeScript, 100% local)        │
                             └──────────────┬───────────────────┘
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

**Requirements:** Node.js 22+. No Python. No native dependencies.

```bash
# 1. Clone and install
git clone https://github.com/diegoalvarezf/context-pilot.git
cd context-pilot
pnpm install
pnpm build

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

> First `index` run downloads the embedding model (~90MB, cached to `~/.context-pilot/models`).

## Stack

- **TypeScript/Node.js 22** — MCP server, CLI, embeddings, code parsing, graph — everything
- **`node:sqlite`** — built-in SQLite, zero native compilation
- **`@huggingface/transformers`** — local ONNX embeddings (`all-MiniLM-L6-v2`, 384 dims)
- **`web-tree-sitter`** — WASM-based code parsing, no node-gyp

## Supported Languages

- TypeScript / JavaScript
- Python
- Go *(planned)*
- Rust *(planned)*

## Roadmap

- [x] MCP server with 5 tools
- [x] TypeScript-native embedding engine (no Python required)
- [x] Knowledge graph with dependency edges
- [x] Intelligent context ranking (semantic + graph + recency)
- [x] CLI (`init`, `index`, `status`, `serve`)
- [x] Incremental indexing + file watcher (`--watch`)
- [ ] VSCode extension (zero-config install)
- [ ] Go / Rust language support

## Contributing

This project is in early development. Contributions, ideas, and feedback are welcome — open an issue!

## License

MIT
