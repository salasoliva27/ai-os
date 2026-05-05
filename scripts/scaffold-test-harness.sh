#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# JANUS IA — TEST-HARNESS SCAFFOLD
# Creates the two artifacts AGENTS.md mandates for every backend:
#   - <backend>/src/routes/test.ts  (/api/test namespace stub)
#   - <backend>/scripts/test-api.sh (end-to-end curl harness)
#
# Usage:
#   scripts/scaffold-test-harness.sh <backend-dir>
# Example:
#   scripts/scaffold-test-harness.sh dashboard/bridge
#
# Refuses to overwrite existing files. Edit after scaffold to wire
# real endpoints and authentication.
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

BACKEND_DIR="${1:-}"
if [ -z "$BACKEND_DIR" ]; then
  echo "usage: $0 <backend-dir>  (e.g. dashboard/bridge, backend, server)"
  exit 1
fi

if [ ! -d "$BACKEND_DIR" ]; then
  echo "error: $BACKEND_DIR is not a directory"
  exit 1
fi

TEST_ROUTE="$BACKEND_DIR/src/routes/test.ts"
TEST_SCRIPT="$BACKEND_DIR/scripts/test-api.sh"

mkdir -p "$(dirname "$TEST_ROUTE")" "$(dirname "$TEST_SCRIPT")"

# ─── 1. test.ts (Express/TS stub) ─────────────────────────────
if [ -f "$TEST_ROUTE" ]; then
  echo "skip: $TEST_ROUTE already exists"
else
  cat > "$TEST_ROUTE" <<'TS'
// /api/test — mounted only when SIMULATION_MODE=true or NODE_ENV=development.
// Scaffolded by scripts/scaffold-test-harness.sh. Wire real handlers below.

import { Router, type Request, type Response } from 'express'

const router = Router()

// Gate: refuse to mount in production
if (process.env.NODE_ENV === 'production' && process.env.SIMULATION_MODE !== 'true') {
  throw new Error('/api/test must not be mounted in production')
}

// Self-documenting index
router.get('/', (_req: Request, res: Response) => {
  res.json({
    endpoints: [
      { method: 'GET', path: '/api/test', desc: 'this listing' },
      { method: 'GET', path: '/api/test/state', desc: 'dump application state' },
      { method: 'POST', path: '/api/test/reset', desc: 'wipe sim data back to seed' }
      // Add feature-level endpoints: /api/test/<feature> GET, /api/test/<feature>/<action> POST, etc.
    ]
  })
})

router.get('/state', (_req: Request, res: Response) => {
  // TODO: dump current store/state
  res.json({ todo: 'implement state dump' })
})

router.post('/reset', (_req: Request, res: Response) => {
  // TODO: wipe sim data, re-seed
  res.json({ ok: true, todo: 'implement reset' })
})

export default router
TS
  echo "created: $TEST_ROUTE"
fi

# ─── 2. test-api.sh (end-to-end curl harness) ─────────────────
if [ -f "$TEST_SCRIPT" ]; then
  echo "skip: $TEST_SCRIPT already exists"
else
  cat > "$TEST_SCRIPT" <<'SH'
#!/usr/bin/env bash
# End-to-end API smoke test. Scaffolded by scaffold-test-harness.sh.
# Run:  bash scripts/test-api.sh
# Flags: --state (state-only) | --sim (skip auth) | --reset (reset first)

set -uo pipefail

BASE="${BASE_URL:-http://localhost:3001}"
GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'

pass() { echo -e "  ${GREEN}✓${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; FAILS=$((FAILS+1)); }
warn() { echo -e "  ${YELLOW}!${NC} $1"; }

FAILS=0
STATE_ONLY=0; SKIP_AUTH=0; DO_RESET=0
for arg in "$@"; do
  case "$arg" in
    --state) STATE_ONLY=1 ;;
    --sim) SKIP_AUTH=1 ;;
    --reset) DO_RESET=1 ;;
  esac
done

echo "▸ API smoke test — BASE=$BASE"

# ─── 1. liveness ──────────────────────────────────────────────
if curl -sf -o /dev/null "$BASE/api/test"; then
  pass "/api/test reachable"
else
  fail "/api/test unreachable — is the server running? is SIMULATION_MODE=true?"
  exit 1
fi

# ─── 2. optional reset ───────────────────────────────────────
if [ "$DO_RESET" = "1" ]; then
  if curl -sf -X POST "$BASE/api/test/reset" -o /dev/null; then
    pass "reset OK"
  else
    fail "reset failed"
  fi
fi

# ─── 3. state dump ───────────────────────────────────────────
STATE=$(curl -sf "$BASE/api/test/state" || echo '{}')
if echo "$STATE" | python3 -m json.tool >/dev/null 2>&1; then
  pass "state endpoint returns valid JSON"
else
  fail "state endpoint returned non-JSON"
fi

[ "$STATE_ONLY" = "1" ] && { echo "$STATE" | python3 -m json.tool; exit 0; }

# ─── 4. auth (unless --sim) ──────────────────────────────────
if [ "$SKIP_AUTH" = "0" ]; then
  warn "auth flow not scaffolded — edit this script to obtain a JWT from your auth provider"
fi

# ─── 5. feature endpoints ────────────────────────────────────
# TODO: add curl calls for each feature's /api/test/<feature> endpoints.

if [ "$FAILS" -gt 0 ]; then
  echo -e "${RED}$FAILS step(s) failed${NC}"
  exit 1
fi
echo -e "${GREEN}all checks passed${NC}"
SH
  chmod +x "$TEST_SCRIPT"
  echo "created: $TEST_SCRIPT"
fi

echo ""
echo "next:"
echo "  1. Mount the test router in your backend entry point:"
echo "       if (process.env.SIMULATION_MODE === 'true') app.use('/api/test', testRouter)"
echo "  2. Fill in /state, /reset, and per-feature endpoints in $TEST_ROUTE"
echo "  3. Add feature-level curl calls to $TEST_SCRIPT"
echo "  4. Verify:  bash $TEST_SCRIPT"
