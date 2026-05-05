#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# JANUS IA — SESSION STOP GATE
# Fires on Claude Code "Stop" event. Refuses to end the session
# until a `most-recent-context` memory for today exists in Supabase.
#
# Why: AGENTS.md mandates a session-handoff anchor. For 30 days it
# was never written. This hook makes it mechanical, not advisory.
#
# Contract:
#   - stdin: JSON with session_id, transcript_path, stop_hook_active
#   - stdout: empty = allow stop | {"decision":"block",...} = continue
# ═══════════════════════════════════════════════════════════════

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WORKSPACE="${WORKSPACE_ROOT:-$SCRIPT_DIR}"
WORKSPACE_NAME="$(basename "$WORKSPACE")"

INPUT=$(cat)

# ─── Anti-loop: if we've already blocked once this turn, allow ───
STOP_ACTIVE=$(echo "$INPUT" | node -e "
let s=''; process.stdin.on('data',c=>s+=c).on('end',()=>{
  try { const d=JSON.parse(s); console.log(d.stop_hook_active===true?'True':'False'); }
  catch { console.log('False'); }
});
" 2>/dev/null)

if [ "$STOP_ACTIVE" = "True" ]; then
  exit 0
fi

# ─── Skip enforcement for trivial sessions ───
TRANSCRIPT=$(echo "$INPUT" | node -e "
let s=''; process.stdin.on('data',c=>s+=c).on('end',()=>{
  try { const d=JSON.parse(s); console.log(d.transcript_path||''); }
  catch { console.log(''); }
});
" 2>/dev/null)

if [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ]; then
  LINE_COUNT=$(wc -l < "$TRANSCRIPT" 2>/dev/null || echo 0)
  # Transcript is JSONL; roughly 2 lines per turn. <20 lines ≈ <10 exchanges.
  if [ "$LINE_COUNT" -lt 20 ]; then
    exit 0
  fi
fi

# ─── Query Supabase for today's anchor ───
SUPABASE_URL="${SUPABASE_URL:-}"
SUPABASE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"

if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_KEY" ]; then
  # No credentials — cannot enforce. Allow exit but log.
  echo "[stop-gate] Supabase credentials missing — skipping enforcement" >&2
  exit 0
fi

TODAY=$(date -u +%Y-%m-%d)

# tags live in metadata->tags (jsonb). Containment filter:
#   metadata=cs.{"tags":["most-recent-context"]}
# URL-encoded: %7B%22tags%22:%5B%22most-recent-context%22%5D%7D
ANCHOR=$(curl -s -m 5 \
  "${SUPABASE_URL}/rest/v1/memories?select=id,created_at&metadata=cs.%7B%22tags%22:%5B%22most-recent-context%22%5D%7D&created_at=gte.${TODAY}&workspace=eq.$WORKSPACE_NAME&limit=1" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" 2>/dev/null || echo "[]")

HAS_ANCHOR=$(echo "$ANCHOR" | node -e "
let s=''; process.stdin.on('data',c=>s+=c).on('end',()=>{
  try { const d=JSON.parse(s); console.log(Array.isArray(d)&&d.length>0?'True':'False'); }
  catch { console.log('False'); }
});
" 2>/dev/null)

if [ "$HAS_ANCHOR" = "True" ]; then
  # Anchor exists — now check memory VOLUME for today.
  # Correction fbcef958 (2026-04-16): "write learnings INLINE, not in a batch at end."
  # Without a volume check, sessions write only the handoff and skip learnings.
  COUNT_RESP=$(curl -s -m 5 \
    "${SUPABASE_URL}/rest/v1/memories?select=id&created_at=gte.${TODAY}&workspace=eq.$WORKSPACE_NAME" \
    -H "apikey: ${SUPABASE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_KEY}" 2>/dev/null || echo "[]")

  MEMORY_COUNT=$(echo "$COUNT_RESP" | node -e "
let s=''; process.stdin.on('data',c=>s+=c).on('end',()=>{
  try { const d=JSON.parse(s); console.log(Array.isArray(d)?d.length:0); }
  catch { console.log(0); }
});
" 2>/dev/null)

  if [ "${MEMORY_COUNT:-0}" -lt 3 ]; then
    cat <<EOF
{
  "decision": "block",
  "reason": "STOP-GATE: Only ${MEMORY_COUNT} memories written today for workspace=${WORKSPACE_NAME}. AGENTS.md mandates memory capture and correction fbcef958 (2026-04-16) requires INLINE learning, not batched. Before ending this session you MUST call \`mcp__memory__remember\` at least $((3 - MEMORY_COUNT)) more time(s) capturing: a learning (surprising discovery, non-obvious bug fix, or tool verdict), a decision (architecture/business/tooling), or a pattern (repeats across 2+ projects). Write them NOW, then return control. If the session genuinely had nothing worth capturing, write a memory saying exactly that with type='session' — but that's rare."
}
EOF
    exit 0
  fi

  # ─── Session-summary check ────────────────────────────────
  # Audit 2026-04-28 recommendation #9: capture_session_summary was called
  # in 1 of 2 sessions (50%). Make it mandatory at the same gate that
  # already enforces anchor + memory volume. The summary is the single
  # cross-session learning artifact — losing it loses the session.
  SUMMARY_RESP=$(curl -s -m 5 \
    "${SUPABASE_URL}/rest/v1/memories?select=id&type=eq.session&metadata=cs.%7B%22tags%22:%5B%22session-summary%22%5D%7D&created_at=gte.${TODAY}&workspace=eq.$WORKSPACE_NAME&limit=1" \
    -H "apikey: ${SUPABASE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_KEY}" 2>/dev/null || echo "[]")

  HAS_SUMMARY=$(echo "$SUMMARY_RESP" | node -e "
let s=''; process.stdin.on('data',c=>s+=c).on('end',()=>{
  try { const d=JSON.parse(s); console.log(Array.isArray(d)&&d.length>0?'True':'False'); }
  catch { console.log('False'); }
});
" 2>/dev/null)

  if [ "$HAS_SUMMARY" != "True" ]; then
    cat <<'EOF'
{
  "decision": "block",
  "reason": "STOP-GATE: No session-summary memory exists for today. Anchor + memory count are satisfied, but the cross-session summary is missing. Before ending, call `mcp__memory__capture_session_summary` (it tags the memory with `session-summary` automatically), OR call `mcp__memory__remember` with type='session' and tags including 'session-summary' explicitly. Audit 2026-04-28: previously only fired in 50% of sessions. Mandatory now."
}
EOF
    exit 0
  fi

  exit 0
fi

# ─── Block: force Claude to write the anchor before ending ───
cat <<'EOF'
{
  "decision": "block",
  "reason": "STOP-GATE: No `most-recent-context` memory exists for today. Before ending this session you MUST call `mcp__memory__remember` with:\n  - workspace: \"janus-ia\"\n  - type: \"session\"\n  - tags: [\"most-recent-context\", \"session-handoff\", <active-project>]\n  - content: a tight handoff containing (1) active tasks & exact state, (2) files touched this session, (3) decisions made, (4) open questions / blockers, (5) literal next 1–3 actions, (6) any uncommitted changes.\nThis is the primary anchor the NEXT session reads first. Without it, context is lost. Write it NOW, then return control."
}
EOF
