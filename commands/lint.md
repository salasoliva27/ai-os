---
description: "Lint the wiki layer — broken wikilinks, orphan files, stale frontmatter"
argument-hint: "[empty | --fix | --stale-days N]"
---

# /lint — Wiki Health Check

Karpathy's third operation (after ingest + query) is **lint**: periodically
check the wiki for contradictions, orphan pages, and missing links. Without
it, rot accumulates silently.

This command runs `scripts/lint-wiki.sh` and surfaces what it finds.

## Parse Arguments

The user invoked `/lint $ARGUMENTS`.

- **empty / no args**: run with defaults (90-day staleness threshold, full report)
- **`--fix`**: after the scan, walk through findings interactively and offer
  to fix each (delete orphan, add `updated:` field, edit broken link, etc.)
  Always per-finding confirmation, never bulk
- **`--stale-days N`**: tighter or looser staleness window (default 90)

## Run the scan

Invoke: `bash scripts/lint-wiki.sh [--stale-days N]`

The script scans: `wiki/`, `concepts/`, `learnings/`, `agents/`, `skills/`,
`modules/` for `.md` files. It reports four categories:

1. **Broken wikilinks** — `[[target]]` where `target.md` doesn't exist
   anywhere in the scan dirs OR at the repo root (CLAUDE/AGENTS/etc.)
2. **Orphan files** — `.md` files with zero inbound `[[wikilinks]]` from
   anywhere. Skips README/index/registry and `agents/core/*` (which are
   referenced from CLAUDE.md/AGENTS.md, not the wiki).
3. **Stale entries** — frontmatter `updated:` field >N days ago
4. **Missing `updated:`** — frontmatter exists but no `updated:` field

Output is printed to stdout AND written to `outputs/lint/report-<date>.md`.
Script exits non-zero if any issues found (useful for CI later).

## After the scan (no --fix)

Read the report and surface the top findings to the user with concrete
context. Don't dump the full report — summarize:

```
**Lint — N issues across 55 files**

Broken wikilinks (8):
  Most are placeholder text ([[links]], [[concept link]]) — content
  authoring gaps, not script bugs. Two reference real-but-missing
  files: [[concepts/env-flag-architecture]].

Orphan files (7):
  Modules under modules/* aren't linked from anywhere in wiki/. Either
  add inbound links or these may be stale.

Frontmatter gaps (6):
  6 files missing `updated:`. Consider adding for staleness tracking.

Run `/lint --fix` to walk through each finding interactively.
```

## With --fix

For each finding, offer:

- **Broken wikilink**: print the source file + the broken target. Options:
  - `r` rename (you provide the correct target; sed-replace in source)
  - `d` delete (remove the link, keep surrounding text)
  - `s` skip
- **Orphan file**: print the file + ask
  - `k` keep (acknowledge it's intentional; skip in future via a comment marker)
  - `d` delete (with confirmation showing first 10 lines)
  - `s` skip
- **Missing `updated:`**: offer to add `updated: <today>` to frontmatter
  - `y` yes / `n` no / `s` skip

Never modify multiple files per keystroke. Per-finding only.

## Critical Rules

- Lint is **read-by-default**. The script never modifies files; only `--fix`
  mode does, and only with per-finding confirmation.
- The script is intentionally conservative about orphans — it skips
  `agents/core/*`, README, index, registry files. If you find a true
  orphan that the user wants to keep (e.g., a draft), they say `k` keep
  in `--fix` mode.
- Don't auto-trigger. Lint runs on `/lint`. (Could be wired to `/evolve`
  later as Phase 0; out of scope for v1.)

## Reporting

After the scan (and optional fixes):

```
**Lint Complete**
- Issues found: <count>
- Fixes applied: <count> / <offered>
- Skipped: <list with reasons>
- Report: outputs/lint/report-<date>.md
- Next: <one suggestion if pattern emerges, e.g. "modules/* are all
  orphans — consider archiving or adding wiki entries that link to them">
```
