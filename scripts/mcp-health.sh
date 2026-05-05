#!/usr/bin/env bash
# MCP Health Check — runs once per Claude Code session via SessionStart hook
# Ensures dependencies are installed and reports status

PPID_LOCK="/tmp/mcp-health-$(ps -o ppid= -p $$ 2>/dev/null | tr -d ' ')-$(date +%Y%m%d).done"
[ -f "$PPID_LOCK" ] && exit 0
touch "$PPID_LOCK"

# Ensure memory MCP dependencies are installed (not committed to git)
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WORKSPACE="${WORKSPACE_ROOT:-$SCRIPT_DIR}"
if [ -d "$WORKSPACE/mcp-servers/memory" ] && [ ! -d "$WORKSPACE/mcp-servers/memory/node_modules" ]; then
  cd "$WORKSPACE/mcp-servers/memory" && npm install --silent 2>/dev/null
  echo "Installed memory MCP dependencies"
fi
