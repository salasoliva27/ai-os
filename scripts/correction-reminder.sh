#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# JANUS IA — CORRECTION REMINDER (UserPromptSubmit hook)
#
# Three-tier behavior (per audit 2026-04-28 + cross-platform fix
# from 1624593):
#   1. STRONG match + janus-memory MCP available + session_id known
#      →  writes /tmp/janus-correction-pending-<SESSION_ID>; the
#         PreToolUse correction-flag-guard.sh BLOCKS every tool
#         except capture_correction / remember until the flag is
#         cleared by correction-flag-clear.sh. This is real,
#         mechanical enforcement — the only style with measured
#         behavioral lift in this repo.
#
#   2. STRONG match + (no MCP OR no session_id)  →  same wording
#      but non-blocking. The blocking mechanism depends on the MCP
#      being callable; when it isn't (Windows / file-based memory),
#      we fall back to a strong reminder + the file-based capture
#      instructions origin's 1624593 added.
#
#   3. SOFT match  →  non-blocking reminder. The model decides.
#
# Flag auto-expires after CORRECTION_FLAG_TTL seconds (default 600).
# Audit data: reminder-only enforcement caught 0/19 redirects in a
# session; the blocking path is what closed that gap on MCP-equipped
# machines.
# ═══════════════════════════════════════════════════════════════

set -uo pipefail

# shellcheck disable=SC1091
. "$(dirname "$0")/_parse_prompt.sh"

INPUT_RAW=$(cat)

# Re-feed the raw input through parse_prompt (it cats stdin internally).
# Same trick origin used: capture INPUT_RAW once, pipe it as needed.
PROMPT=$(printf '%s' "$INPUT_RAW" | parse_prompt)

[ -z "$PROMPT" ] && exit 0

# Session ID — needed for the per-session flag file. Same cross-platform
# fallback pattern as parse_prompt: try python3 first, fall back to sed.
extract_session_id() {
  if python3 -c "import json" >/dev/null 2>&1; then
    printf '%s' "$INPUT_RAW" | python3 -c "
import json, sys
try:
    d = json.loads(sys.stdin.read())
    print(d.get('session_id', '') or d.get('sessionId', ''))
except Exception:
    print('')
" 2>/dev/null
    return
  fi
  printf '%s' "$INPUT_RAW" | sed -n 's/.*"session[_]\?[Ii]d"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1
}
SESSION_ID=$(extract_session_id)

LOWER=$(echo "$PROMPT" | tr '[:upper:]' '[:lower:]')

# Soft redirect (high false-positive risk; non-blocking reminder)
PATTERNS='(^|[[:space:],.!?])(no|don'"'"'t|do not|not that|stop|wrong|actually|instead|nope|don'"'"'t do)($|[[:space:],.!?])'
PATTERNS_ES='(^|[[:space:],.!?])(no|para|detente|mal|incorrecto|en realidad|en vez|mejor no)($|[[:space:],.!?])'

# Strong redirect (very high confidence; eligible for BLOCKING when MCP is up)
STRONG='(that'"'"'s not|that is not|you'"'"'re wrong|you are wrong|don'"'"'t do that|no hagas|no no|redirect|i didn'"'"'t ask|i did not ask|eso no|así no|asi no|mal enfoque|wrong approach|stop doing|deja de|por qué hiciste|why did you do|that was wrong)'

STRONG_HIT=0
SOFT_HIT=0
if echo "$LOWER" | grep -qE "$STRONG"; then
  STRONG_HIT=1
elif echo "$LOWER" | grep -qE "$PATTERNS" || echo "$LOWER" | grep -qE "$PATTERNS_ES"; then
  SOFT_HIT=1
fi

# Backend detection: MCP path vs file-based fallback.
HAVE_MCP=0
if [ -n "${SUPABASE_URL:-}" ] && [ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  HAVE_MCP=1
fi

# ─── Tier 1: STRONG + MCP + session_id → BLOCKING ───
if [ "$STRONG_HIT" -eq 1 ] && [ "$HAVE_MCP" -eq 1 ] && [ -n "$SESSION_ID" ]; then
  FLAG="/tmp/janus-correction-pending-${SESSION_ID}"
  PROMPT_ONELINE=$(echo "$PROMPT" | tr '\n' ' ' | cut -c 1-500)
  printf '%s\t%s\n' "$(date +%s)" "$PROMPT_ONELINE" > "$FLAG"

  cat <<'EOF'
▸ CORRECTION-CAPTURE REQUIRED — BLOCKING

This prompt contains a high-confidence redirect signal ("you're wrong",
"don't do that", "no no", "redirect", etc). Per the 2026-04-28 audit,
correction capture rate was 0/19 with reminder-only enforcement; this
hook now BLOCKS other tool calls until you record the correction.

REQUIRED — your next tool call MUST be one of:
  • mcp__memory__capture_correction(original=..., correction=..., context=..., workspace="janus-ia", project=<current>)
  • mcp__memory__remember(type="correction", ...)

After that call succeeds, the flag clears automatically and you can
continue normally.

If this is a FALSE POSITIVE (the prompt sounded like a redirect but
isn't actually correcting your behavior), just call:
  mcp__memory__remember(type="learning", content="STRONG correction-pattern false positive: <user prompt snippet>", tags=["false-positive", "correction-hook-tuning"])
That clears the flag AND tunes the hook over time.

The flag auto-expires after 10 minutes if no tool runs.
EOF
  exit 0
fi

# ─── Tier 2 / 3: non-blocking reminders ───
# No match? Done.
if [ "$STRONG_HIT" -eq 0 ] && [ "$SOFT_HIT" -eq 0 ]; then
  exit 0
fi

# Header line conveys signal strength so the model can weight it.
if [ "$STRONG_HIT" -eq 1 ]; then
  HEADER="▸ CORRECTION-REMINDER (STRONG signal — blocking is unavailable on this machine; capture before continuing anyway)"
else
  HEADER="▸ CORRECTION-REMINDER (soft signal — not blocking)"
fi

if [ "$HAVE_MCP" -eq 1 ]; then
  cat <<EOF
$HEADER

This prompt contains a redirect pattern. Per AGENTS.md evolution rule:
write the correction BEFORE the fix.

  1. Call mcp__memory__capture_correction(original, correction, context, workspace="janus-ia", project=<current>)
  2. Then address what the user asked

Audit 2026-04-28: reminder-only capture rate was ~0%. The capture is what
tunes future sessions — skipping it means repeating the same mistake next
time. False positive? Skip the capture and proceed normally.
EOF
else
  # File-based fallback (Windows / no janus-memory MCP). Origin's 1624593
  # added the precise instructions; preserved verbatim.
  SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
  WORKSPACE="${WORKSPACE_ROOT:-$SCRIPT_DIR}"
  CLAUDE_PROJECT_DIR="$(echo "$WORKSPACE" | sed 's|[/:]|-|g')"
  MEMORY_DIR="$HOME/.claude/projects/$CLAUDE_PROJECT_DIR/memory"
  cat <<EOF
$HEADER

The janus-memory MCP is NOT available on this machine. Use file-based capture:
  1. Write tool → \`$MEMORY_DIR/correction_<slug>.md\` with frontmatter:
       ---
       name: <short name>
       description: <one-line trigger — so future-you decides relevance>
       type: correction
       ---
       **Original**: what I did / was about to do
       **Correction**: what Jano said
       **Why**: why this matters for future sessions
       **How to apply**: when/where this rule kicks in
  2. Append a one-line pointer to \`$MEMORY_DIR/MEMORY.md\`:
       - [<name>](correction_<slug>.md) — <hook>
  3. THEN address what the user asked

Rule (AGENTS.md evolution): write the correction BEFORE the fix — not
after. If you code first and memory-capture last, the capture gets skipped
and you repeat the mistake next session.

False positive? If this prompt is not actually a correction, skip and
proceed normally. Non-blocking.
EOF
fi
