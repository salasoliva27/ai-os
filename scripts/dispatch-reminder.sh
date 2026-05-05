#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# JANUS IA — DISPATCH REMINDER (UserPromptSubmit hook)
# Scans the incoming user prompt for keywords that match the
# AGENTS.md dispatch protocol. If matches, injects a gentle
# context note reminding the model that an agent spec exists.
#
# NON-BLOCKING. The model decides whether to invoke. The goal is
# to make the decorative dispatch table actually visible at the
# decision point, not to force behavior.
#
# Diagnostic 2026-04-20 found 1 subagent dispatch across 20 sessions.
# Prompt-only rules weren't cutting through.
# ═══════════════════════════════════════════════════════════════

set -uo pipefail

# shellcheck disable=SC1091
. "$(dirname "$0")/_parse_prompt.sh"

PROMPT=$(parse_prompt)

[ -z "$PROMPT" ] && exit 0

# Lowercase for keyword match
LOWER=$(echo "$PROMPT" | tr '[:upper:]' '[:lower:]')

# Map keyword → agent spec path (from AGENTS.md agent registry)
declare -A HITS=()

match() {
  local pattern="$1"
  local agent="$2"
  if echo "$LOWER" | grep -qE "$pattern"; then
    HITS["$agent"]=1
  fi
}

match 'new idea|nuevo producto|product intake'                                  'agents/core/intake.md'
match 'deploy|shipping to (uat|prod)|production release|tag release'            'agents/core/deploy.md'
match 'market|competitor|research|validar mercado'                              'agents/core/research.md'
match 'legal|compliance|contract|regulat|lfpdppp|ley fintech'                   'agents/core/legal.md'
match 'financ|burn|revenue|budget|p&l|mxn|cash flow'                            'agents/core/financial.md'
match 'calendar|schedule|meeting|reminder'                                      'agents/core/calendar.md'
match 'cross[- ]project|trickle|propagate across'                               'agents/core/trickle-down.md'
match 'nutrition|clinical|diet|patient|nutri'                                   'agents/domain/nutrition.md'
match 'performance|metric|weekly summary|dashboard numbers'                     'agents/core/performance.md'
match 'visual (check|verify)|playwright|screenshot|ui check'                    'agents/core/ux.md'
match 'security|owasp|vuln|rls|auth check'                                      'agents/core/security.md'
match "product coherence|doesn'?t make sense|pre[- ]demo|launch audit"          'agents/core/oversight.md'
match 'marketing|campaign|brand|cold email|content|video'                       'agents/core/marketing.md'
match 'evolve|self[- ]improve|memory consolidat'                                'agents/core/evolve.md'
match 'frontend|ui|component|css|react|tsx'                                     'agents/core/developer.md + agents/core/ux.md'
match 'build|feature|refactor|implement|code'                                   'agents/core/developer.md'

if [ ${#HITS[@]} -eq 0 ]; then
  exit 0
fi

# Emit additional context (UserPromptSubmit hook can pipe JSON with additionalContext)
echo "▸ DISPATCH-REMINDER: prompt keywords suggest these agent spec(s) may be relevant — read before starting. Diagnostic 2026-04-20 found 1 subagent dispatch across 20 sessions; the dispatch table exists but isn't used."
for agent in "${!HITS[@]}"; do
  echo "  → $agent"
done
echo "Consider Agent() with an appropriate subagent_type, OR read the spec(s) directly for behavioral guidance. Non-blocking."
