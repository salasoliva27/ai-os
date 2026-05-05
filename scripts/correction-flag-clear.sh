#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# JANUS IA — CORRECTION FLAG CLEAR (PostToolUse hook)
#
# Runs after every tool call. If the call was capture_correction (or a
# correction-typed remember, or a false-positive learning remember),
# clears the blocking flag set by correction-reminder.sh.
# ═══════════════════════════════════════════════════════════════

set -uo pipefail

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

# Any of these clear the flag — the user asked for capture, we got
# something memory-shaped from the model, that's good enough.
case "$TOOL_NAME" in
  *capture_correction*|*remember*)
    rm -f "$FLAG"
    ;;
esac

exit 0
