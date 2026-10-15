#!/usr/bin/env bash
set -e

echo ""
echo "  context-pilot setup"
echo "  ────────────────────"
echo ""

if ! command -v node &>/dev/null; then
  echo "  ✗ Node.js not found. Install from https://nodejs.org (>=22)"
  exit 1
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "  ✗ Node.js 22+ required (found $(node --version))"
  exit 1
fi

if ! command -v git &>/dev/null; then
  echo "  ✗ git not found — context-pilot mines git history"
  exit 1
fi

if ! command -v pnpm &>/dev/null; then
  echo "  Installing pnpm..."
  npm install -g pnpm
fi

echo "  Installing dependencies..."
pnpm install

echo "  Building TypeScript..."
pnpm build

echo ""
echo "  ✓ Setup complete"
echo ""
echo "  Next steps:"
echo "    cd your-project"
echo "    context-pilot init"
echo "    context-pilot index"
echo "    context-pilot co-changes path/to/file"
echo ""
echo "  Add to Claude Code:"
echo "    claude mcp add context-pilot -- context-pilot serve --project ."
echo ""
