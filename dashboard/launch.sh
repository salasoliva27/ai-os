#!/usr/bin/env bash
# Launch Venture OS Dashboard (bridge serves built frontend)
# Usage: bash dashboard/launch.sh        (from repo root)
#        bash launch.sh                   (from dashboard/)
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${VENTURE_OS_PORT:-3100}"

# Kill any existing process
pid=$(lsof -ti :$PORT 2>/dev/null || true)
[ -n "$pid" ] && kill $pid 2>/dev/null && echo "Killed stale process on :$PORT"

sleep 0.3

# Build frontend if needed
cd "$DIR"
npm run build:frontend

# Start bridge (serves built frontend + WebSocket + API)
exec npx tsx bin/venture-os.ts
