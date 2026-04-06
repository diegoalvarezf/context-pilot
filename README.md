# context-pilot

> Intelligent context middleware for AI coding agents.
> MCP-compatible · 100% local · privacy-first · no Python

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCP Compatible](https://img.shields.io/badge/MCP-compatible-blue)](https://modelcontextprotocol.io)
[![Node.js 22+](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)
[![Status: Beta](https://img.shields.io/badge/status-beta-orange)]()

**Works with:** Claude Code · Cursor · Continue.dev · Zed · any MCP client

---

## The problem

Every AI coding agent has the same blind spot: **context is dumb**.

It injects whichever files are open, grabs the top-N semantic matches, and forgets everything the moment the session ends. It doesn't know that `auth.ts` and `middleware.ts` are always edited together. It doesn't remember that you decided *not* to use Redis three months ago. It has no idea that the function you're editing is called by 12 other files.

There's no layer that manages **what context to inject, when, and why**.

## The solution

**context-pilot** is a middleware MCP server that sits between your AI client and your codebase. It builds a local knowledge graph of your project and uses three signals at once to decide what context is actually relevant:

```
┌──────────────┐     MCP      ┌─────────────────────────────────────────┐
│  AI Client   │◄────────────►│              context-pilot              │
│ (Claude Code,│              │                                         │
│  Cursor, ...) │             │  ┌──────────┐ ┌────────┐ ┌──────────┐  │
└──────────────┘              │  │ Semantic │+│ Graph  │+│ Recency  │  │
                              │  │ search   │ │ signal │ │ signal   │  │
                              │  └──────────┘ └────────┘ └──────────┘  │
                              │         embedding engine                │
                              └───────────────────┬─────────────────────┘
                                                  ▼
                                       ┌──────────────────┐
                                       │  ~/.context-pilot │
                                       │  db.sqlite        │
                                       │  (local only)     │
                                       └──────────────────┘
```

**Semantic search** finds code similar to your prompt. **Graph signal** boosts results that are close to your active file in the import graph. **Recency** boosts files you've touched recently. The three combine into a single ranked list.

Plus: every architectural decision you tell it to remember is embedded and retrieved semantically — your past choices inform future answers.

---

## Demo

### Before context-pilot

```
You: "Add rate limiting to the payment endpoint"

Agent grabs: package.json, the 3 most-recently opened files, and a generic
rate-limiter example from a completely different part of the codebase.

Result: generic boilerplate, wrong import paths, misses that you already
have a rate limiter in src/lib/rate-limit.ts.
```

### With context-pilot

```
You: "Add rate limiting to the payment endpoint"

query_context runs → ranks 20 candidates using semantic + graph + recency

Returns:
  src/lib/rate-limit.ts:1-45      (score: 0.94) ← your existing rate limiter
  src/routes/payments.ts:1-82     (score: 0.91) ← the endpoint itself
  src/middleware/auth.ts:12-34    (score: 0.78) ← used in the same route
  [decision] "Use in-memory rate limiter, Redis rejected (2024-11) — 
              adds infra dependency for marginal gain"  (score: 0.81)

Result: agent reuses your existing implementation, follows your past decision,
correct imports on the first try.
```

### `context-pilot status`

```
$ context-pilot status

  project   my-api  (/Users/me/repos/my-api)
  indexed   2 minutes ago
  files     847
  chunks    3,241
  memories  12 architectural decisions stored
  graph     4,102 import edges
```

---

## Quick start

**Requirements:** Node.js 22+. No Python. No Docker. No native compilation.

```bash
# 1. Clone and build
git clone https://github.com/diegoalvarezf/context-pilot.git
cd context-pilot
pnpm install && pnpm build

# 2. Link the CLI globally
npm link packages/cli

# 3. Go to your project
cd /path/to/your-project

# 4. Initialize and index
context-pilot init
context-pilot index
# First run downloads the embedding model (~90MB, cached to ~/.context-pilot/models)

# 5. Check what was indexed
context-pilot status
```

> The watcher keeps the index live as you code — no need to re-index manually.

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

### Continue.dev

Add to `~/.continue/config.json`:

```json
{
  "experimental": {
    "modelContextProtocolServers": [
      {
        "transport": {
          "type": "stdio",
          "command": "context-pilot",
          "args": ["serve", "--project", ".", "--watch"]
        }
      }
    ]
  }
}
```

### Zed

Add to your Zed settings:

```json
{
  "context_servers": {
    "context-pilot": {
      "command": {
        "path": "context-pilot",
        "args": ["serve", "--project", ".", "--watch"]
      }
    }
  }
}
```

---

## MCP Tools

| Tool | When to use |
|------|-------------|
| `query_context` | Before writing code — get relevant functions, patterns, and past decisions |
| `index_project` | After cloning or after large refactors |
| `remember` | Save an architectural decision so it persists across sessions |
| `get_graph` | Understand the blast radius of a change — who calls this function? |
| `search_code` | Semantic search when you know what you're looking for |

### `query_context` response shape

```json
{
  "context": "// src/lib/rate-limit.ts:1-45 (createRateLimiter)\nfunction createRateLimiter...",
  "sources": [
    { "path": "src/lib/rate-limit.ts", "name": "createRateLimiter", "lines": "1-45", "score": 0.94 },
    { "path": "src/routes/payments.ts", "name": null, "lines": "1-82", "score": 0.91 }
  ],
  "memories": [
    {
      "id": "abc123",
      "memory_type": "decision",
      "content": "Use in-memory rate limiter. Redis rejected — adds infra dependency for marginal gain.",
      "score": 0.81
    }
  ],
  "token_count": 1842
}
```

Code context and architectural memories in one call.

---

## How ranking works

```
final_score = 0.55 × semantic_similarity
            + 0.20 × graph_proximity      ← distance to active file in the import graph
            + 0.15 × co-edit score        ← files historically changed in the same session
            + 0.10 × recency              ← how recently the file was modified
```

All signals are derived automatically — no config, no annotations.

- **Graph** is built from import statements at index time
- **Co-edit** is learned from your watcher sessions: every time files change together, their relationship strengthens
- **Recency** comes from filesystem `mtime`

---

## Stack

| Layer | Technology |
|-------|-----------|
| MCP server | `@modelcontextprotocol/sdk` |
| Embeddings | `@huggingface/transformers` — ONNX, local, `all-MiniLM-L6-v2` (384 dims) |
| Code parsing | `web-tree-sitter` — WASM, no node-gyp |
| Storage | `node:sqlite` — built-in Node.js 22, zero native compilation |
| Runtime | TypeScript / Node.js 22 — everything in one language |

Zero Python. Zero Docker. Zero native modules that break on CI.

---

## Supported languages

| Language | Status |
|----------|--------|
| TypeScript / TSX | Supported |
| JavaScript / JSX | Supported |
| Python | Supported |
| Go | Planned |
| Rust | Planned |

---

## Roadmap

- [x] MCP server with 5 tools
- [x] TypeScript-native embedding engine (no Python required)
- [x] Import graph — built from source during indexing
- [x] Ranking: semantic + graph proximity + recency
- [x] Semantic memory — architectural decisions embedded and retrieved
- [x] CLI (`init`, `index`, `status`, `serve`)
- [x] Incremental indexing + file watcher (`--watch`)
- [x] Co-edit signal — files historically edited together are boosted in ranking
- [ ] VSCode extension (zero-config install)
- [ ] Go / Rust language support

---

## Contributing

Early stage. Issues, ideas, and PRs are very welcome.

## License

MIT
