#!/usr/bin/env bash
# Sync janus-ia upstream paths to downstream replicas (ai-os, pablo-ia, jp-ai).
#
# Reads .janus/sync-manifest.yaml. Paths under `sync:` propagate from this repo
# into each downstream; `never_sync:` is left untouched in the downstream
# (user's projects, credentials, instance state). One-way: upstream → downstream.
#
# Default mode is dry-run — shows what would change per downstream without
# writing anything. Use --apply to actually copy + commit + push to a NEW
# branch (never main) and open a PR by default.
#
# Usage:
#   ./scripts/sync-downstreams.sh                       # dry-run all 3
#   ./scripts/sync-downstreams.sh --only ai-os          # one downstream
#   ./scripts/sync-downstreams.sh --apply               # apply, push branch, open PR
#   ./scripts/sync-downstreams.sh --apply --no-pr       # apply, push branch, no PR
#   ./scripts/sync-downstreams.sh --apply --branch foo  # custom branch name
#
# Reads GITHUB_TOKEN from ~/.env (the personal token, not GITHUB_TOKEN_REECE
# — see memory/reference_github_token_routing.md). Owner is salasoliva27.

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────
UPSTREAM_OWNER="salasoliva27"
UPSTREAM_REPO="janus-ia"
DOWNSTREAMS=("ai-os" "pablo-ia" "jp-ai")
WORK_ROOT="${HOME}/.janus-sync"
MANIFEST_REL=".janus/sync-manifest.yaml"

# ── Args ──────────────────────────────────────────────────────────────────
APPLY=0
OPEN_PR=1
ONLY=""
BRANCH="janus-sync/$(date -u +%Y-%m-%d)"
VERBOSE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1; shift ;;
    --no-pr) OPEN_PR=0; shift ;;
    --only) ONLY="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --verbose|-v) VERBOSE=1; shift ;;
    -h|--help) sed -n '1,30p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# ── Locate upstream + manifest ────────────────────────────────────────────
UPSTREAM_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="${UPSTREAM_DIR}/${MANIFEST_REL}"
if [[ ! -f "$MANIFEST" ]]; then
  echo "manifest not found: $MANIFEST" >&2
  exit 1
fi
UPSTREAM_SHA="$(cd "$UPSTREAM_DIR" && git rev-parse --short HEAD)"

# ── Load token ────────────────────────────────────────────────────────────
ENV_FILE="${HOME}/.env"
GH_TOKEN="$(grep -E '^export GITHUB_TOKEN=' "$ENV_FILE" 2>/dev/null \
            | head -n1 | sed -E 's/^export GITHUB_TOKEN="?([^"]+)"?.*/\1/')"
if [[ -z "$GH_TOKEN" ]]; then
  echo "GITHUB_TOKEN not in ~/.env (need personal token, not _REECE)" >&2
  exit 1
fi

# ── Parse manifest into two arrays (sync, never_sync) ─────────────────────
parse_section() {
  # Args: <section_name> — emits one path per line.
  local section="$1"
  awk -v sec="$section" '
    BEGIN { in_sec=0 }
    # Top-level section header (no indent), name followed by colon
    /^[A-Za-z_]+:$/ {
      in_sec = ($1 == sec ":") ? 1 : 0
      next
    }
    in_sec && /^[[:space:]]*-[[:space:]]+/ {
      # Strip leading "- ", quotes, and trailing comments
      sub(/^[[:space:]]*-[[:space:]]+/, "", $0)
      sub(/[[:space:]]+#.*$/, "", $0)
      gsub(/^"|"$/, "", $0)
      gsub(/^'\''|'\''$/, "", $0)
      if (length($0) > 0) print $0
    }
  ' "$MANIFEST"
}

mapfile -t SYNC_PATHS < <(parse_section "sync")
mapfile -t NEVER_SYNC_PATHS < <(parse_section "never_sync")

if [[ ${#SYNC_PATHS[@]} -eq 0 ]]; then
  echo "no sync paths parsed from $MANIFEST — check manifest format" >&2
  exit 1
fi

# ── Helpers ───────────────────────────────────────────────────────────────
log()  { printf '\033[36m[sync]\033[0m %s\n' "$*" >&2; }
warn() { printf '\033[33m[warn]\033[0m %s\n' "$*" >&2; }
err()  { printf '\033[31m[err ]\033[0m %s\n' "$*" >&2; }

ensure_clone() {
  # Ensure $WORK_ROOT/$repo exists and is on default branch with latest.
  local repo="$1"
  local dir="${WORK_ROOT}/${repo}"
  mkdir -p "$WORK_ROOT"
  if [[ ! -d "$dir/.git" ]]; then
    log "cloning ${UPSTREAM_OWNER}/${repo} → ${dir}"
    git clone --quiet "https://${GH_TOKEN}@github.com/${UPSTREAM_OWNER}/${repo}.git" "$dir"
  else
    log "fetching ${repo}"
    git -C "$dir" remote set-url origin "https://${GH_TOKEN}@github.com/${UPSTREAM_OWNER}/${repo}.git" >/dev/null
    git -C "$dir" fetch --quiet origin
  fi
  local default_branch
  default_branch="$(git -C "$dir" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null \
                    | sed 's@^origin/@@' || echo main)"
  git -C "$dir" checkout --quiet "$default_branch"
  git -C "$dir" reset --hard --quiet "origin/${default_branch}"
  echo "$dir"
}

copy_one_path() {
  # Copy upstream path into downstream, preserving structure.
  # Skips paths in NEVER_SYNC_PATHS just in case (defense-in-depth).
  local src_root="$1"
  local dst_root="$2"
  local rel="$3"
  local src="${src_root%/}/${rel}"
  local dst="${dst_root%/}/${rel}"
  for never in "${NEVER_SYNC_PATHS[@]}"; do
    if [[ "$rel" == "$never" || "$rel" == "${never%/}" ]]; then
      warn "  skipped (in never_sync): $rel"
      return
    fi
  done
  if [[ ! -e "$src" ]]; then
    warn "  upstream missing: $rel  (skipping)"
    return
  fi
  mkdir -p "$(dirname "$dst")"
  if [[ -d "$src" ]]; then
    # ADDITIVE sync. Copy CONTENTS of src into dst — same-named files get
    # overwritten, new files get added, downstream-only files PRESERVED.
    # Critical for downstreams that have legitimately diverged inside
    # synced paths (e.g. jp-ai's Ozum-specific agents under agents/core/).
    # The trailing /. on src is the sh-portable way to copy directory
    # contents (not the directory itself) into dst.
    mkdir -p "$dst"
    cp -af "${src}/." "${dst}/"
  else
    mkdir -p "$(dirname "$dst")"
    cp -af "$src" "$dst"
  fi
}

sync_one_downstream() {
  local repo="$1"
  log "─────────────────────────────────────────────────────────────"
  log "downstream: $repo"
  local dir
  dir="$(ensure_clone "$repo")"

  # Stage the sync on a fresh branch (always; even dry-run, so we can diff).
  if git -C "$dir" show-ref --verify --quiet "refs/heads/${BRANCH}"; then
    git -C "$dir" branch -D "$BRANCH" >/dev/null
  fi
  local default_branch
  default_branch="$(git -C "$dir" symbolic-ref --short HEAD)"
  git -C "$dir" checkout --quiet -b "$BRANCH"

  log "  copying ${#SYNC_PATHS[@]} sync paths from janus-ia@${UPSTREAM_SHA}"
  local copied=0
  for rel in "${SYNC_PATHS[@]}"; do
    copy_one_path "$UPSTREAM_DIR" "$dir" "$rel"
    copied=$((copied+1))
  done

  # Diff summary
  git -C "$dir" add -A
  local stat
  stat="$(git -C "$dir" diff --cached --shortstat || echo '')"
  if [[ -z "$stat" ]]; then
    log "  no changes — downstream already in sync"
    git -C "$dir" checkout --quiet "$default_branch"
    git -C "$dir" branch -D "$BRANCH" >/dev/null
    return
  fi
  log "  diff:${stat}"

  if (( APPLY == 0 )); then
    # File-status counts (always shown so the user sees how many adds vs
    # modifies vs deletes — important for catching destructive sync bugs).
    log "  DRY-RUN — file-status counts:"
    git -C "$dir" diff --cached --name-status | awk '{print $1}' \
      | sort | uniq -c | awk '{printf "    %s: %s\n", $2, $1}' >&2
    if (( VERBOSE == 1 )); then
      log "  full file list:"
      git -C "$dir" diff --cached --name-status | sed 's/^/    /'
    else
      log "  first 30 files (use --verbose for full list):"
      git -C "$dir" diff --cached --name-status | head -n 30 | sed 's/^/    /'
    fi
    # Surface any deletes prominently — they're the dangerous ones
    local del_count
    del_count="$(git -C "$dir" diff --cached --name-status | grep -c '^D' || true)"
    if (( del_count > 0 )); then
      warn "  ⚠  $del_count file(s) would be DELETED in $repo:"
      git -C "$dir" diff --cached --name-status | grep '^D' | sed 's/^/      /'
    fi
    git -C "$dir" reset --hard --quiet "$default_branch"
    git -C "$dir" checkout --quiet "$default_branch"
    git -C "$dir" branch -D "$BRANCH" >/dev/null
    return
  fi

  # Apply mode: commit + push branch
  git -C "$dir" -c user.name="janus-sync" -c user.email="janus-sync@local" \
      commit --quiet -m "chore(janus): sync from janus-ia@${UPSTREAM_SHA}"
  log "  pushing branch ${BRANCH} to origin"
  git -C "$dir" push --quiet --set-upstream origin "$BRANCH"

  if (( OPEN_PR == 1 )); then
    local title body
    title="chore(janus): sync from janus-ia@${UPSTREAM_SHA}"
    body=$'Automated downstream sync from upstream `janus-ia`.\n\nSource SHA: `'"${UPSTREAM_SHA}"$'`\n\nGenerated by `scripts/sync-downstreams.sh`. Reads `.janus/sync-manifest.yaml`.\n\nReview the diff before merging.'
    local pr_resp
    # Use python for JSON encoding (handles all string escaping correctly,
    # avoids the jq dependency).
    local pr_payload
    pr_payload="$(TITLE="$title" HEAD="$BRANCH" BASE="$default_branch" BODY="$body" \
      python -c 'import json, os; print(json.dumps({"title": os.environ["TITLE"], "head": os.environ["HEAD"], "base": os.environ["BASE"], "body": os.environ["BODY"]}))')"
    pr_resp="$(curl -sS -X POST \
      -H "Authorization: Bearer ${GH_TOKEN}" \
      -H "Accept: application/vnd.github+json" \
      -H "User-Agent: janus-sync" \
      "https://api.github.com/repos/${UPSTREAM_OWNER}/${repo}/pulls" \
      -d "$pr_payload")"
    local pr_url
    pr_url="$(echo "$pr_resp" | python -c 'import json,sys; d=json.load(sys.stdin); print(d.get("html_url",""))' 2>/dev/null || echo '')"
    if [[ -n "$pr_url" ]]; then
      log "  PR opened: $pr_url"
    else
      local pr_msg
      pr_msg="$(echo "$pr_resp" | python -c 'import json,sys; d=json.load(sys.stdin); print(d.get("message", str(d)[:200]))' 2>/dev/null || echo "$pr_resp")"
      err "  PR open failed: $pr_msg"
    fi
  fi

  git -C "$dir" checkout --quiet "$default_branch"
}

# ── Main ──────────────────────────────────────────────────────────────────
log "upstream: ${UPSTREAM_OWNER}/${UPSTREAM_REPO}@${UPSTREAM_SHA}"
log "branch:   ${BRANCH}"
log "mode:     $([[ $APPLY -eq 1 ]] && echo APPLY || echo dry-run)"
log "sync paths: ${#SYNC_PATHS[@]}  · never-sync: ${#NEVER_SYNC_PATHS[@]}"

for repo in "${DOWNSTREAMS[@]}"; do
  if [[ -n "$ONLY" && "$repo" != "$ONLY" ]]; then continue; fi
  sync_one_downstream "$repo"
done

log "done."
