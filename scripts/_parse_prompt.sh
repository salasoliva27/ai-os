#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# JANUS IA — PROMPT PARSER HELPER
# Sourced by correction-reminder.sh and dispatch-reminder.sh. Given
# a JSON payload on stdin (as Claude Code emits to UserPromptSubmit
# hooks), extracts the `prompt` or `user_message` field.
#
# Works cross-platform: prefers python3, falls back to node (with
# PATH discovery matching ./dash), last-resort falls back to a
# sed-based extraction that handles most prompts.
# ═══════════════════════════════════════════════════════════════

# Resolve a usable node binary. Sets NODE_BIN if found.
_find_node() {
  if command -v node >/dev/null 2>&1; then
    NODE_BIN="node"
    return 0
  fi
  for candidate in \
      "/c/Program Files/nodejs/node.exe" \
      "/c/Program Files (x86)/nodejs/node.exe" \
      "$HOME/AppData/Local/Programs/nodejs/node.exe" \
      "$HOME/bin/nodejs/node.exe" \
      "$HOME/scoop/apps/nodejs/current/node.exe"; do
    if [ -x "$candidate" ]; then
      NODE_BIN="$candidate"
      return 0
    fi
  done
  NODE_BIN=""
  return 1
}

# Reads JSON on stdin, prints value of `prompt` (or `user_message` fallback).
parse_prompt() {
  local input
  input=$(cat)

  # 1. python3 — real only (the MS Store stub on Windows fails `import json`)
  if python3 -c "import json" >/dev/null 2>&1; then
    echo "$input" | python3 -c "
import json, sys
try:
    d = json.loads(sys.stdin.read())
    print(d.get('prompt', '') or d.get('user_message', ''))
except Exception:
    print('')
" 2>/dev/null
    return
  fi

  # 2. node — reliable JSON parsing
  if _find_node; then
    echo "$input" | "$NODE_BIN" -e "
let s=''; process.stdin.on('data',c=>s+=c);
process.stdin.on('end',()=>{
  try { const d = JSON.parse(s||'{}'); console.log(d.prompt || d.user_message || ''); }
  catch(e) { console.log(''); }
});" 2>/dev/null
    return
  fi

  # 3. sed fallback — handles common case, not fully JSON-escape-aware
  echo "$input" | sed -n 's/.*"prompt"[[:space:]]*:[[:space:]]*"\(\([^"\\]\|\\.\)*\)".*/\1/p' | head -1
}
