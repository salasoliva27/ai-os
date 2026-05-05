---
description: "Ingest raw sources from dump/ into the wiki layer (Karpathy operation #1)"
argument-hint: "[empty | <file-or-folder> | --since <date>]"
---

# /ingest — Raw Sources → Wiki

Karpathy's first operation: **drop sources, LLM reads them, updates wiki
pages.** This command processes new files in `dump/` (especially
`dump/clippings/` from Obsidian Web Clipper) and proposes updates to
relevant wiki entries.

## Setup (one-time, manual)

Web Clipper installation lives outside Janus — install once, point at the
right folder:

1. Install **Obsidian Web Clipper** browser extension (Chrome/Firefox/Safari
   from https://obsidian.md/clipper)
2. In Web Clipper settings:
   - **Vault**: pick this Janus instance's repo as your Obsidian vault
   - **Default folder**: `dump/clippings`
   - **Filename template**: `{{date:YYYY-MM-DD}}-{{title}}` (or your taste)
3. Done. Future article clips land in `dump/clippings/<date>-<title>.md`
   ready for `/ingest` to pick up.

If you don't use Web Clipper, just drop any markdown/text/PDF into `dump/`
manually — `/ingest` finds whatever's there.

## Parse Arguments

The user invoked `/ingest $ARGUMENTS`.

- **empty / no args**: scan `dump/clippings/` and `dump/` (top level) for
  files NOT yet in `dump/_processed/`. Process all unprocessed.
- **`<path>`**: process this specific file or folder (overrides default scan)
- **`--since <YYYY-MM-DD>`**: only process files mtime'd after this date

## Phase 1 — Discovery

Find new sources:

```bash
# Top-level files in dump/ + everything in dump/clippings/
find dump -maxdepth 1 -type f -newer dump/_processed/.last-scan 2>/dev/null
find dump/clippings -type f 2>/dev/null
```

Filter out `dump/_processed/` and any file already symlinked there.
List candidates to the user, ask "process all N? (y/n/select)".

## Phase 2 — Per-source ingestion

For each source file, in sequence:

1. **Read** the file. Tolerate markdown, plain text, and (where possible)
   PDF text extraction.
2. **Summarize** to the user: source name, ~3-line summary of what it
   contains, why it might matter.
3. **Identify affected wiki pages**:
   - Search existing `wiki/` + `concepts/` + `learnings/` for relevant
     keywords (use the source's tags, title, or main entities)
   - Propose: "this looks relevant to `[[concepts/X]]` and `[[wiki/Y]]`,
     and might warrant a new entry in `learnings/Z.md`"
4. **Per-target proposal**: for each candidate target page, write a draft
   patch (additions only — never delete existing content during ingest).
   Show the diff. Ask `y` apply / `n` skip / `e` edit.
5. **Mark processed**: when the source is fully handled (or explicitly
   skipped), move it to `dump/_processed/<orig-relpath>` so it won't be
   re-ingested next time.

## Phase 3 — Lint pass (optional, opt-in)

After ingest, suggest running `/lint` — new wikilinks added during ingest
might be broken (target page doesn't exist yet, or the user typo'd a path).

## Critical Rules

- **Never delete existing wiki content during ingest.** Ingest is
  additive: append synthesized notes, add new wikilinks, create new
  pages. If a contradiction surfaces, flag it for `/lint` to address
  later.
- **Per-target confirmation.** A single source might affect 3 wiki pages;
  each one gets its own y/n/e prompt. No bulk apply.
- **Preserve attribution.** When you append synthesized content from a
  source, add a `> source: dump/clippings/2026-05-04-foo.md` line so the
  origin is traceable.
- **Mark processed atomically.** Move the source into `dump/_processed/`
  AFTER the user has resolved every target proposal for it. If the user
  bails mid-source, leave it in `dump/` so `/ingest` can resume.
- **Don't process the same source twice.** The `_processed/` move is the
  idempotency mechanism; respect it.

## Where to put it

```
dump/
├── clippings/                 ← Web Clipper writes here
│   └── 2026-05-04-foo.md
├── 2026-05-03-manual-paste.md ← user manually dropped this
└── _processed/                ← ingest moves files here when done
    └── clippings/
        └── 2026-04-29-bar.md
```

`dump/_processed/.last-scan` is touched after each `/ingest` run so
`--newer` filtering works on subsequent runs.

## Reporting

After the run:

```
**Ingest Complete**
- Sources scanned: N
- Sources processed: M (skipped K)
- Wiki pages updated: <count>
- New wiki pages created: <list>
- Stale links introduced: <count> — run /lint to verify
- Next: <suggestion>
```
