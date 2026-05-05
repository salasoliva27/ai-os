#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# JANUS IA — CORRECTION FLAG GUARD (PreToolUse hook)
#
# When a STRONG correction signal fired, correction-reminder.sh wrote
# /tmp/janus-correction-pending-<SESSION_ID>. This hook reads that flag
# and DENIES every tool call except capture_correction / remember /
# trivial reads (so the model can think but not act on the original
# request before recording the correction).
#
# Flag auto-expires after CORRECTION_FLAG_TTL seconds (default 600).
# The flag is cleared by correction-flag-clear.sh (PostToolUse) when
# capture_correction or a correction-typed remember succeeds.
#
# Contract:
#   - stdin: JSON {tool_name, tool_input, session_id, ...}
#   - stdout: empty = allow | {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"..."}} = block
# ═══════════════════════════════════════════════════════════════

set -uo pipefail

CORRECTION_FLAG_TTL="${CORRECTION_FLAG_TTL:-600}"

INPUT=$(cat)

read SESSION_ID TOOL_NAME < <(echo "$INPUT" | python3 -c "
import json, sys
try:
    d = json.loads(sys.stdin.read())
except Exception:
    print('', '')
    sys.exit(0)
sid = d.get('session_id', '') or d.get('sessionId', '')
tool = d.get('tool_name', '') or d.get('toolName', '')
print(sid, tool)
" 2>/dev/null)

[ -z "$SESSION_ID" ] && exit 0

FLAG="/tmp/janus-correction-pending-${SESSION_ID}"
[ ! -f "$FLAG" ] && exit 0

# TTL expiry
FLAG_TS=$(awk -F'\t' 'NR==1 {print $1}' "$FLAG" 2>/dev/null || echo 0)
NOW=$(date +%s)
AGE=$((NOW - FLAG_TS))
if [ "$AGE" -gt "$CORRECTION_FLAG_TTL" ]; then
  rm -f "$FLAG"
  exit 0
fi

# Whitelist: capture_correction (the right answer) and remember (the
# false-positive escape hatch + correction-typed remember). We also let
# memory listing/recall through because they're read-only and useful
# for forming the correction.
case "$TOOL_NAME" in
  *capture_correction*|*remember*|*recall*|*list_memories*)
    exit 0
    ;;
esac

cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "CORRECTION-CAPTURE REQUIRED: The previous user prompt was flagged as a high-confidence correction (see /tmp/janus-correction-pending-${SESSION_ID}). Before any other tool, call mcp__memory__capture_correction (or mcp__memory__remember type=correction). If this was a false positive, call mcp__memory__remember type=learning with tags=['false-positive','correction-hook-tuning'] to clear the flag AND record tuning data. Auto-expires in $((CORRECTION_FLAG_TTL - AGE))s."
  }
}
EOF
