#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# JANUS IA — MEMORY PRIVACY AUDIT
#
# Scans the shared memory dir for content that should not be there
# under the AGENTS.md "Memory Privacy" rule. Manual safety net; does
# not block writes.
#
# Run weekly:  bash scripts/memory-audit.sh
# Override dir: MEMORY_DIR=/path/to/dir bash scripts/memory-audit.sh
# Custom client/codename denylist: scripts/memory-audit-denylist.txt
#   (one term per line, # comments allowed; matched case-insensitively)
#
# Exit codes: 0 = clean, 2 = hits found, 1 = config error.
# ═══════════════════════════════════════════════════════════════

set -uo pipefail

DEFAULT_DIR="/c/Users/alejandro.salas/.claude/projects/C--Users-alejandro-salas-Documents-ASO-JanusAI-janus-ia/memory"
MEMORY_DIR="${MEMORY_DIR:-$DEFAULT_DIR}"

if [[ ! -d "$MEMORY_DIR" ]]; then
    echo "✗ memory dir not found: $MEMORY_DIR" >&2
    echo "  set MEMORY_DIR=/path/to/dir and re-run" >&2
    exit 1
fi

DENYLIST="$(dirname "$0")/memory-audit-denylist.txt"

# patterns that should not appear in shared memory
PATTERNS=(
    '\$[0-9]'
    '€[0-9]'
    '[0-9]+[.,][0-9]+%'
    '\b[0-9]{4,}\b'
    '\b(MRR|ARR|EBITDA|P&L|revenue|payroll|runway|valuation|burn[[:space:]]rate)\b'
    '\b(client|customer)[[:space:]]+[A-Z][a-z]+'
    '(api[_-]?key|secret[_-]?key|bearer[[:space:]]+[A-Za-z0-9])'
    '(sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{16,}|xox[baprs]-)'
)

shopt -s nullglob
files=( "$MEMORY_DIR"/*.md )
shopt -u nullglob

if [[ ${#files[@]} -eq 0 ]]; then
    echo "✓ memory dir is empty: $MEMORY_DIR"
    exit 0
fi

echo "▸ scanning $MEMORY_DIR (${#files[@]} files)"
echo

hits=0

for f in "${files[@]}"; do
    name="$(basename "$f")"
    [[ "$name" == "MEMORY.md" ]] && continue

    # frontmatter contract: contains_sensitive: false must be declared
    if ! head -20 "$f" | grep -qE '^contains_sensitive:[[:space:]]*false[[:space:]]*$'; then
        echo "⚠ missing 'contains_sensitive: false' frontmatter:"
        echo "    $f"
        hits=$((hits+1))
    fi

    # built-in pattern scan
    for pat in "${PATTERNS[@]}"; do
        matches=$(grep -nEi "$pat" "$f" 2>/dev/null || true)
        if [[ -n "$matches" ]]; then
            echo "⚠ pattern /$pat/"
            echo "    $f"
            echo "$matches" | sed 's/^/      /'
            hits=$((hits+1))
        fi
    done

    # custom denylist (client names, internal codenames)
    if [[ -f "$DENYLIST" ]]; then
        while IFS= read -r line || [[ -n "$line" ]]; do
            [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
            line="$(echo "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
            [[ -z "$line" ]] && continue
            matches=$(grep -nFi -- "$line" "$f" 2>/dev/null || true)
            if [[ -n "$matches" ]]; then
                echo "⚠ denylist term '$line'"
                echo "    $f"
                echo "$matches" | sed 's/^/      /'
                hits=$((hits+1))
            fi
        done < "$DENYLIST"
    fi
done

echo
if [[ $hits -eq 0 ]]; then
    echo "✓ no hits — memory is clean"
    exit 0
else
    echo "⚠ $hits hit(s) — review above and either rewrite or delete the offending memory"
    exit 2
fi
