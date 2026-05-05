#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# JANUS IA — SIBLING LOG SHOW (UserPromptSubmit hook)
#
# Surfaces, as additional context, what other concurrent Claude
# sessions have edited in the last 2 hours plus recent git commits.
# Lets the current session detect when files it cares about have
# been changed by a sibling chat between turns.
#
# Non-blocking. Output is injected back to the model.
# ═══════════════════════════════════════════════════════════════

set -uo pipefail

INPUT=$(cat)
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
LOG_FILE="$PROJECT_DIR/.janus/session-log.jsonl"

CURRENT_SID=$(echo "$INPUT" | node -e "
let s=''; process.stdin.on('data',c=>s+=c).on('end',()=>{
  try {
    const d = JSON.parse(s);
    const sid = d.session_id || d.sessionId || '';
    process.stdout.write(sid.slice(0,8));
  } catch (e) {}
});
" 2>/dev/null)

OUTPUT=""

# ─── Recent edits from OTHER sessions, last 2h, deduped per (session,file) ───
if [ -f "$LOG_FILE" ]; then
  RECENT=$(tail -n 500 "$LOG_FILE" 2>/dev/null | node -e "
const cur = process.argv[1] || '';
const cutoff = Date.now() - 2*60*60*1000;
let s=''; process.stdin.on('data',c=>s+=c).on('end',()=>{
  const out = new Map();
  for (const ln of s.split('\n').filter(Boolean)) {
    try {
      const e = JSON.parse(ln);
      if (!e.session || e.session === cur) continue;
      const t = new Date(e.ts).getTime();
      if (!t || t < cutoff) continue;
      out.set(e.session + '|' + e.file, e);
    } catch {}
  }
  const entries = [...out.values()].sort((a,b) => a.ts.localeCompare(b.ts)).slice(-20);
  for (const e of entries) {
    process.stdout.write('  [' + e.session + '] ' + e.tool + ' ' + e.file + ' (' + e.ts + ')\n');
  }
});
" "$CURRENT_SID" 2>/dev/null)

  if [ -n "$RECENT" ]; then
    OUTPUT="${OUTPUT}▸ SIBLING-SESSION ACTIVITY (last 2h, other Claude sessions):
${RECENT}"
  fi
fi

# ─── Recent git commits, last 2h ───
GITLOG=$(git -C "$PROJECT_DIR" log --since="2 hours ago" --oneline 2>/dev/null | head -n 10)
if [ -n "$GITLOG" ]; then
  GITLOG_INDENTED=$(echo "$GITLOG" | sed 's/^/  /')
  OUTPUT="${OUTPUT}▸ RECENT COMMITS (last 2h):
${GITLOG_INDENTED}
"
fi

[ -z "$OUTPUT" ] && exit 0

echo "$OUTPUT"
echo "If you're about to edit a listed file, run \`git status\` / \`git diff\` first — sibling sessions may have changed it underneath you."

exit 0
