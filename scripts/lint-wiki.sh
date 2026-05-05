#!/usr/bin/env bash
# Lint the Janus wiki layer.
#
# Scans wiki/ + concepts/ + learnings/ + agents/ + skills/ + modules/ for:
#   - Broken [[wikilinks]]      (target file doesn't exist)
#   - Orphan files              (no inbound wikilinks anywhere)
#   - Stale frontmatter         (updated: > N days ago, default 90)
#   - Missing `updated:`        (frontmatter exists but no date)
#
# Output goes to stdout AND a timestamped report under outputs/lint/.
#
# Usage:
#   ./scripts/lint-wiki.sh                 # default: 90-day staleness
#   ./scripts/lint-wiki.sh --stale-days 30 # tighter staleness threshold
#   ./scripts/lint-wiki.sh --quiet         # only print summary (no per-finding lines)
#   ./scripts/lint-wiki.sh --no-report     # skip writing outputs/lint/report-<date>.md

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCAN_DIRS=("wiki" "concepts" "learnings" "agents" "skills" "modules")
STALE_DAYS=90
QUIET=0
WRITE_REPORT=1
TODAY="$(date -u +%Y-%m-%d)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stale-days) STALE_DAYS="$2"; shift 2 ;;
    --quiet) QUIET=1; shift ;;
    --no-report) WRITE_REPORT=0; shift ;;
    -h|--help) sed -n '1,20p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

cd "$ROOT"

# ── Collect all .md files in scan dirs ─────────────────────────────────
ALL_FILES=()
for d in "${SCAN_DIRS[@]}"; do
  [[ -d "$d" ]] || continue
  while IFS= read -r f; do ALL_FILES+=("$f"); done < <(find "$d" -type f -name "*.md")
done

if [[ ${#ALL_FILES[@]} -eq 0 ]]; then
  echo "no .md files found in any of: ${SCAN_DIRS[*]}" >&2
  exit 1
fi

# ── Build basename index for wikilink resolution ───────────────────────
# A [[link]] resolves if:
#   - There's a file named "link.md" anywhere in scan dirs, OR
#   - There's a file at the literal path "link.md" relative to ROOT, OR
#   - The link is a valid heading anchor inside an existing file
declare -A BASENAMES   # basename (no .md, no path) → "1"
declare -A FULL_PATHS  # path-with-or-without-md → "1"
for f in "${ALL_FILES[@]}"; do
  bn="$(basename "$f" .md)"
  BASENAMES["$bn"]=1
  FULL_PATHS["$f"]=1
  no_ext="${f%.md}"
  FULL_PATHS["$no_ext"]=1
done

# Also index root-level .md files (CLAUDE, AGENTS, README, TOOLS,
# CREDENTIALS, PROJECTS, PORTFOLIO-MAP, CHANGELOG, etc.). These are
# legitimately wikilinkable from inside the wiki layer.
for f in *.md; do
  [[ -f "$f" ]] || continue
  bn="$(basename "$f" .md)"
  BASENAMES["$bn"]=1
  FULL_PATHS["$f"]=1
  FULL_PATHS["${f%.md}"]=1
done

# ── Pass 1: extract every wikilink target ──────────────────────────────
# wikilink syntax: [[target]] or [[target|alias]] or [[target#section]]
# We strip alias and section to get the bare target.
declare -A LINK_TARGETS_BY_FILE  # file → space-separated targets
declare -A INBOUND_COUNT         # target basename → count of inbound links

for f in "${ALL_FILES[@]}"; do
  # grep -oE prints each match on its own line; sed strips [[ ]] and alias/section.
  # Tolerate files with zero wikilinks (grep returns 1).
  targets="$(grep -oE '\[\[[^]]+\]\]' "$f" 2>/dev/null \
             | sed -E 's/^\[\[//; s/\]\]$//; s/\|.*//; s/#.*//' \
             | sort -u 2>/dev/null || true)"
  if [[ -n "$targets" ]]; then
    LINK_TARGETS_BY_FILE["$f"]="$targets"
    while IFS= read -r t; do
      [[ -z "$t" ]] && continue
      # Inbound count is keyed by basename (case-sensitive, exact)
      tb="$(basename "$t" .md)"
      INBOUND_COUNT["$tb"]=$(( ${INBOUND_COUNT["$tb"]:-0} + 1 ))
    done <<< "$targets"
  fi
done

# ── Pass 2: find broken wikilinks ──────────────────────────────────────
BROKEN=()
for f in "${ALL_FILES[@]}"; do
  targets="${LINK_TARGETS_BY_FILE[$f]:-}"
  [[ -z "$targets" ]] && continue
  while IFS= read -r t; do
    [[ -z "$t" ]] && continue
    # Try resolving:
    #   1. basename match
    #   2. exact path match (with or without .md)
    #   3. relative-to-source-dir match
    tb="$(basename "$t" .md)"
    if [[ -n "${BASENAMES[$tb]:-}" ]] || \
       [[ -n "${FULL_PATHS[$t]:-}" ]] || \
       [[ -n "${FULL_PATHS[${t}.md]:-}" ]]; then
      continue
    fi
    BROKEN+=("$f → [[$t]]")
  done <<< "$targets"
done

# ── Pass 3: find orphan files (zero inbound wikilinks) ─────────────────
# Skip files that are clearly NOT meant to be wiki entries:
#   - registry files (skills/registry.md, tools/registry.md)
#   - README files
#   - index files
ORPHANS=()
for f in "${ALL_FILES[@]}"; do
  bn="$(basename "$f" .md)"
  case "$bn" in
    README|readme|index|registry) continue ;;
  esac
  # Skip files inside agents/core/ — these are referenced from CLAUDE.md /
  # AGENTS.md (synced, frequently-edited) and don't always have wiki inbound.
  case "$f" in
    agents/core/*) continue ;;
  esac
  count="${INBOUND_COUNT[$bn]:-0}"
  if [[ "$count" -eq 0 ]]; then
    ORPHANS+=("$f")
  fi
done

# ── Pass 4: stale frontmatter ──────────────────────────────────────────
# Look for an `updated:` line in YAML frontmatter (between the first two ---).
STALE=()
MISSING_UPDATED=()
for f in "${ALL_FILES[@]}"; do
  # Only consider files that HAVE frontmatter
  if ! head -n 1 "$f" 2>/dev/null | grep -qE '^---$'; then
    continue
  fi
  # Extract the frontmatter block (lines between the first two --- markers).
  # All these greps may legitimately return no match; under `set -e` + pipefail
  # that aborts the loop, so we explicitly tolerate empty results.
  fm="$(awk 'BEGIN{n=0} /^---$/{n++; next} n==1{print} n>=2{exit}' "$f" || true)"
  updated_line="$(printf '%s\n' "$fm" | grep -E '^updated:' | head -n1 || true)"
  if [[ -z "$updated_line" ]]; then
    MISSING_UPDATED+=("$f")
    continue
  fi
  date_str="$(printf '%s\n' "$updated_line" | sed -E 's/^updated:[[:space:]]*"?([0-9-]+)"?.*/\1/' || true)"
  if ! [[ "$date_str" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    continue
  fi
  # Days since updated. Tolerate `date -d` failures on weird input.
  now_s=$(date -u +%s || echo 0)
  then_s=$(date -d "$date_str" +%s 2>/dev/null || echo 0)
  if [[ "$then_s" -gt 0 ]]; then
    days_ago=$(( (now_s - then_s) / 86400 ))
    if [[ "$days_ago" -gt "$STALE_DAYS" ]]; then
      STALE+=("$f  (updated $date_str, $days_ago days ago)")
    fi
  fi
done

# ── Output ─────────────────────────────────────────────────────────────
TOTAL_FILES=${#ALL_FILES[@]}
TOTAL_LINKS=0
for f in "${!LINK_TARGETS_BY_FILE[@]}"; do
  count_in_file=$(echo "${LINK_TARGETS_BY_FILE[$f]}" | wc -l)
  TOTAL_LINKS=$((TOTAL_LINKS + count_in_file))
done

REPORT=$(cat <<EOF
# Janus wiki lint — $TODAY

**Scanned**: ${SCAN_DIRS[*]}
**Files**: $TOTAL_FILES · **Wikilinks**: $TOTAL_LINKS
**Stale threshold**: $STALE_DAYS days

## Summary

- Broken wikilinks: ${#BROKEN[@]}
- Orphan files: ${#ORPHANS[@]}
- Stale entries: ${#STALE[@]}
- Frontmatter missing \`updated:\`: ${#MISSING_UPDATED[@]}

## Broken wikilinks ($([ ${#BROKEN[@]} -eq 0 ] && echo "none ✓" || echo "${#BROKEN[@]} found"))
$(if [[ ${#BROKEN[@]} -eq 0 ]]; then echo ""; else printf -- "- %s\n" "${BROKEN[@]}"; fi)

## Orphan files ($([ ${#ORPHANS[@]} -eq 0 ] && echo "none ✓" || echo "${#ORPHANS[@]} found"))
$(if [[ ${#ORPHANS[@]} -eq 0 ]]; then echo ""; else printf -- "- %s\n" "${ORPHANS[@]}"; fi)

## Stale entries (>$STALE_DAYS days, $([ ${#STALE[@]} -eq 0 ] && echo "none ✓" || echo "${#STALE[@]} found"))
$(if [[ ${#STALE[@]} -eq 0 ]]; then echo ""; else printf -- "- %s\n" "${STALE[@]}"; fi)

## Frontmatter missing \`updated:\` ($([ ${#MISSING_UPDATED[@]} -eq 0 ] && echo "none ✓" || echo "${#MISSING_UPDATED[@]} found"))
$(if [[ ${#MISSING_UPDATED[@]} -eq 0 ]]; then echo ""; else printf -- "- %s\n" "${MISSING_UPDATED[@]}"; fi)
EOF
)

if [[ "$QUIET" -eq 1 ]]; then
  echo "$REPORT" | head -n 8
else
  echo "$REPORT"
fi

if [[ "$WRITE_REPORT" -eq 1 ]]; then
  mkdir -p outputs/lint
  outfile="outputs/lint/report-${TODAY}.md"
  echo "$REPORT" > "$outfile"
  echo ""
  echo "Report written to: $outfile"
fi

# Exit non-zero if any issues found (useful for CI)
total_issues=$(( ${#BROKEN[@]} + ${#ORPHANS[@]} + ${#STALE[@]} + ${#MISSING_UPDATED[@]} ))
if [[ "$total_issues" -gt 0 ]]; then
  exit 1
fi
exit 0
