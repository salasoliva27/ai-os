#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# JANUS IA — SIBLING LOG APPEND (PostToolUse hook, matcher Edit|Write|NotebookEdit)
#
# Appends one JSON line to .janus/session-log.jsonl per file mutation:
#   { "ts": "<ISO>", "session": "<sid8>", "tool": "<name>", "file": "<path>" }
#
# Other concurrent Claude sessions read this file on UserPromptSubmit
# (sibling-log-show.sh) so they can see what changed underneath them
# between turns.
#
# Non-blocking. Always exits 0.
# ═══════════════════════════════════════════════════════════════

set -uo pipefail

INPUT=$(cat)

PARSED=$(echo "$INPUT" | node -e "
let s=''; process.stdin.on('data',c=>s+=c).on('end',()=>{
  try {
    const d = JSON.parse(s);
    const sid = d.session_id || d.sessionId || '';
    const tool = d.tool_name || d.toolName || '';
    const ti = d.tool_input || d.toolInput || {};
    const file = ti.file_path || ti.filePath || ti.notebook_path || ti.notebookPath || '';
    if (!sid || !tool || !file) return;
    if (!/^(Edit|Write|NotebookEdit)$/.test(tool)) return;
    const entry = { ts: new Date().toISOString(), session: sid.slice(0,8), tool, file };
    process.stdout.write(JSON.stringify(entry));
  } catch (e) {}
});
" 2>/dev/null)

[ -z "$PARSED" ] && exit 0

LOG_DIR="${CLAUDE_PROJECT_DIR:-.}/.janus"
LOG_FILE="$LOG_DIR/session-log.jsonl"

mkdir -p "$LOG_DIR" 2>/dev/null || true
echo "$PARSED" >> "$LOG_FILE" 2>/dev/null || true

exit 0
