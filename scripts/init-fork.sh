#!/usr/bin/env bash
# init-fork.sh — bootstrap a fresh janus-ia fork for a new user.
#
# Strips Jano-specific content (his project wikis, outputs, specific learnings)
# while keeping the core agent framework intact: agents/, concepts/, scripts/,
# dashboard/, mcp-servers/, registries, AGENTS.md, and CLAUDE.md loader.
#
# Run ONCE after cloning/forking. It's idempotent — safe to re-run, but it
# will warn before deleting directories that already look stripped.
#
# Usage:
#   ./scripts/init-fork.sh            → interactive, asks before stripping
#   ./scripts/init-fork.sh --yes      → non-interactive, just do it

set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

YES=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y) YES=1 ;;
    *) echo "unknown flag: $arg"; exit 1 ;;
  esac
done

if [ ! -f "$REPO/AGENTS.md" ] || [ ! -f "$REPO/CLAUDE.md" ] || [ ! -d "$REPO/agents" ]; then
  echo "× $REPO doesn't look like a janus-ia fork (missing AGENTS.md, CLAUDE.md loader, or agents/)" >&2
  exit 1
fi

cat <<EOF
┌──────────────────────────────────────────────────────────┐
│  JANUS FORK BOOTSTRAP                                     │
├──────────────────────────────────────────────────────────┤
│  Stripping Jano-specific content:                         │
│    - wiki/          (his project pages)                   │
│    - projects/      (his dev/uat/prod tracking)           │
│    - outputs/       (his generated docs + screenshots)    │
│    - dump/          (his inbox)                           │
│    - concepts/*     (his accumulated cross-project nodes) │
│  Resetting to empty templates:                            │
│    - PROJECTS.md                                          │
│    - learnings/* (all his accumulated findings)           │
│                                                           │
│  Keeping the framework:                                   │
│    ✓ AGENTS.md, CLAUDE.md loader, agents/                 │
│    ✓ scripts/, dashboard/, mcp-servers/                   │
│    ✓ tools/registry.md, skills/registry.md                │
│                                                           │
│  After this runs, launch \`./dash\` — the dashboard will   │
│  walk you through first-run discovery.                    │
└──────────────────────────────────────────────────────────┘
EOF

if [ "$YES" != "1" ]; then
  read -r -p "proceed? [y/N] " ans
  case "$ans" in
    y|Y|yes) ;;
    *) echo "aborted"; exit 0 ;;
  esac
fi

echo ""
echo "▸ removing Jano-specific dirs..."
for d in wiki projects outputs dump; do
  if [ -d "$REPO/$d" ]; then
    rm -rf "$REPO/$d"
    echo "  removed $d/"
  fi
done

# concepts/ is Jano's accumulated cross-project nodes. Wipe contents but
# keep the directory so the agent framework's [[concepts/...]] links still
# resolve to a real folder once Pablo writes his own.
if [ -d "$REPO/concepts" ]; then
  rm -f "$REPO/concepts"/*.md
  echo "  emptied concepts/"
fi

# agents/domain/ holds project-specific agents (e.g. nutrition for nutri-ai).
# core agents are universal roles and stay.
if [ -d "$REPO/agents/domain" ]; then
  rm -f "$REPO/agents/domain"/*.md
  echo "  emptied agents/domain/"
fi

# Wipe any pre-existing learnings — every file in here gets reset to a stub
# below. This catches Jano-specific files (patterns.md, technical.md,
# mcp-registry.md, gtm.md) without us having to enumerate them by name.
if [ -d "$REPO/learnings" ]; then
  rm -f "$REPO/learnings"/*.md
  echo "  emptied learnings/"
fi

echo "▸ resetting templates..."
cat > "$REPO/PROJECTS.md" <<'TEMPLATE'
# Projects

No projects yet. Add entries as you start building:

## Template

| Project | Stage | Module(s) | Next step |
|---|---|---|---|
| example | dev | validation + build | finalize intake |

Full per-project pages live in `wiki/<name>.md`.
TEMPLATE

mkdir -p "$REPO/learnings"
cat > "$REPO/learnings/market.md" <<'TEMPLATE'
# Market knowledge

Track market-level learnings here: industry data, competitor notes, regulatory
snapshots, pricing benchmarks. Write one section per geography/vertical. The
AI re-reads this before research or go/no-go decisions.
TEMPLATE

cat > "$REPO/learnings/supabase-registry.md" <<'TEMPLATE'
# Supabase registry

If/when projects in this fork start using Supabase, register every table here:
purpose, schema file path, and which projects write to it. This is how the AI
avoids cross-project schema collisions.

| Table | Purpose | Schema | Writers |
|---|---|---|---|
TEMPLATE

cat > "$REPO/learnings/cross-project-map.md" <<'TEMPLATE'
---
type: learning
tags: [cross-project, relationships, map]
---
# Cross-Project Map

Maps relationships between all projects. The pre-flight check parses the
`## Capacity` section to show your active backlog.

## Shared Infrastructure

| Resource | Projects | Notes |
|---|---|---|

## Cross-Cutting Patterns

(Patterns that repeat across 2+ projects get their own concept node in
`concepts/` and link back here.)

## Capacity

No active projects yet. Add bullets like:
- [[wiki/<project-slug>]] — short status (N sessions to next milestone)

Total: 0 sessions queued.
Rule: capacity-aware intake — flag new requests when backlog is full.
TEMPLATE

if [ -f "$REPO/CHANGELOG.md" ]; then
  echo "▸ resetting CHANGELOG.md..."
  echo "# Changelog" > "$REPO/CHANGELOG.md"
fi

# ─── Rewrite README to a generic template ─────────────────────
FORK_NAME="$(basename "$REPO")"
echo "▸ resetting README.md → $FORK_NAME..."
cat > "$REPO/README.md" <<TEMPLATE
# $FORK_NAME

Personal AI brain. Built on Claude Code with an agent dispatch protocol,
file-based memory, MCP integrations, and a workspace-aware dashboard.

## First run

\`\`\`bash
./dash              # launch the dashboard
\`\`\`

In the first chat turn, tell the AI: **\`run discovery\`**. It will walk you
through declaring your projects, your stack, and personalizing the agents in
\`agents/\`, \`AGENTS.md\`, and provider adapter files for your work.

## Layout

\`\`\`
agents/         agent specs (developer, ux, legal, financial, ...)
concepts/       cross-project patterns (the compounding layer)
learnings/      domain knowledge (market, technical, gtm, patterns)
dashboard/      the UI you launch with ./dash
mcp-servers/    local MCP servers (memory, etc.)
scripts/        bootstrap, preflight, gdrive, dash-link, init-fork
tools/          tool registry + configs
skills/         skills registry
AGENTS.md       canonical brain and agent registry
CLAUDE.md       Claude Code compatibility loader
\`\`\`

\`AGENTS.md\` is the provider-neutral source of truth. Personalize it during
discovery before doing real work.
TEMPLATE

# ─── Drop stale planning artifacts and project-specific agents ──
echo "▸ removing stale planning + project-specific agents..."
for d in "$REPO/.planning" "$REPO/dashboard/.planning" "$REPO/agents/legal"; do
  if [ -d "$d" ]; then
    rm -rf "$d"
    echo "  removed ${d#$REPO/}"
  fi
done

# ─── Bulk rewrite janus/Jano prose in user-facing markdown ──────
# Derive a friendly owner name from the fork dir: "pablo-ia" → "Pablo".
# Strips trailing -ia/-ai/-brain suffixes, then capitalizes.
OWNER="$(echo "$FORK_NAME" | sed -E 's/-(ia|ai|brain)$//; s/^./\U&/')"
DISPLAY="${OWNER} IA"
echo "▸ rewriting brand references → owner=\"$OWNER\", display=\"$DISPLAY\"..."

# Find user-facing markdown (skip .git, node_modules, dist, .planning).
# Apply four ordered substitutions per file.
find "$REPO" \
  -path "$REPO/.git" -prune -o \
  -path "*/node_modules" -prune -o \
  -path "*/dist" -prune -o \
  -path "*/.planning" -prune -o \
  -type f -name "*.md" -print | while read -r f; do
    # Order matters: longer/more-specific first to avoid partial overwrites.
    sed -i \
      -e "s|JANUS IA|$(echo "$DISPLAY" | tr '[:lower:]' '[:upper:]')|g" \
      -e "s|Janus IA|$DISPLAY|g" \
      -e "s|janus-ia|$FORK_NAME|g" \
      -e "s|\bJano\b|$OWNER|g" \
      "$f"
  done
echo "  rewrote brand refs across all user-facing .md"

# ─── Self-anchor hook + MCP paths ─────────────────────────────
# .claude/settings.json hooks and .mcp.json paths reference
# /workspaces/janus-ia. Point them at this fork instead.
echo "▸ rewriting hardcoded /workspaces/janus-ia paths..."
for f in "$REPO/.claude/settings.json" "$REPO/.mcp.json"; do
  if [ -f "$f" ]; then
    # Use | as sed delimiter since paths contain /
    sed -i "s|/workspaces/janus-ia|$REPO|g" "$f"
    echo "  rewrote $f"
  fi
done

echo ""
echo "✓ fork initialized."
echo ""
echo "next:"
echo "  ./dash              # launch the dashboard"
echo "                      # first turn, tell the AI: 'run discovery'"
