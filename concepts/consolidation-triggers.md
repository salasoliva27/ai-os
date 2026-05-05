---
type: concept
tags:
  - meta
  - vault-plasticity
  - consolidation
  - learning-system
created: '2026-04-17'
---
# Consolidation Triggers

## What it is
The decision rules for when and how to compound scattered knowledge. [[CLAUDE]]'s "Vault Plasticity" section says the brain restructures as understanding changes — this concept says *what kind of restructure* each situation calls for.

## Why it matters
Consolidation work is where the Janus system gets compounding leverage (see [[concepts/protocol-enforcement]]). But "consolidate" is not one action — it's five. Picking the wrong one turns a 5-minute fix into either a botched rewrite or a half-measure that leaves drift in place. This concept catalogues the five triggers and the right response for each.

## The five consolidation triggers

### 1. Concept-worthy cluster — write a new `concepts/` node

**Trigger:** 2+ memories (or 2+ notes) describe the same root cause with different symptoms.

**Response:** Create `concepts/{slug}.md` that names the root cause, lists the symptomatic memories by ID, frames the enforcement rule, and is linked from `learnings/patterns.md`.

**Example:** Iter 1 of 2026-04-17 learning mode — 5 correction memories (6a0df030, fbcef958, 396d5cee, 787e4713, b1374193, b1dc5de5) all described the same "AI drift toward ship-artifact-skip-protocol" pattern. Collapsed into [[concepts/protocol-enforcement]].

**Don't do this when:** only one memory exists — it may be a one-off. Wait for the pattern to repeat.

---

### 2. Scattered operational knowledge — consolidate into a `learnings/` file

**Trigger:** 3+ related facts/gotchas exist as loose memories but have no canonical page that an operating agent would read during the relevant work.

**Response:** Add a named section to the appropriate `learnings/*.md` file. The section should be discoverable by the agent that would trip over it (dev gotchas → `technical.md`, market facts → `market.md`).

**Example:** Iter 2 — tsx-watch fix, Codespace 0.0.0.0 binding, GSAP opacity conflict, dashboard-serves-from-dist, MCP-disconnect-is-permanent were all in memory but invisible during build work. Added as "Dev-environment gotchas" section to [[learnings/technical]].

**Don't do this when:** the knowledge is project-specific, not cross-project. That belongs in `wiki/{project}.md`.

---

### 3. Deprecated-but-full file — truncate to a pointer

**Trigger:** A file has a deprecation banner but retains its full pre-deprecation content. Risk: future session reads the stale content, or updates the wrong file.

**Response:** Rewrite to a ~15-line pointer file — the deprecation banner, pointers to the current file(s), and an explicit "do not update this file" note. Preserve the path so existing `[[links]]` don't break.

**Example:** Iter 2 — `learnings/mcp-registry.md` was marked deprecated but still had 400 lines of duplicated registry content. Truncated to a pointer to `tools/registry.md` + `skills/registry.md`.

**Don't do this when:** the file has content not yet migrated to the new location. Migrate first, then truncate.

---

### 4. Stale auto-generated snapshot — add a freshness banner

**Trigger:** An auto-generated file (codebase snapshot, analysis output) contains details that were true at write time but have since drifted. Rewriting is risky because the content still has historical value.

**Response:** Prepend a prominent ⚠️ banner that: (a) states when it was generated, (b) flags specific errors in the file (wrong paths, wrong names, inverted notes), (c) points to canonical current sources. Do not rewrite the body.

**Example:** Iter 6 — `.planning/codebase/{ARCHITECTURE,INTEGRATIONS,STRUCTURE,STACK,CONVENTIONS}.md` were generated 2026-04-13 with `venture-os` paths. All 5 got STALE banners that pointed to live sources. Body preserved for historical reference.

**Don't do this when:** the file is operational (read by an agent during active work). Those need actual fixes, not warnings.

---

### 5. Registry or graph drift — rewrite with current reality

**Trigger:** A registry file (supabase-registry, cross-project-map, tools/registry) has entries that reference paths, tool names, table names, or relationships that no longer match reality. Agents read these and act on them.

**Response:** Rewrite the file in full. Agents treat these as authoritative — a partial patch that leaves drift in another entry creates confidence-without-correctness, worse than a known-stale banner.

**Example:** Iter 4 — `learnings/supabase-registry.md` had 6 staleness issues (wrong MCP path, wrong tool prefix, missing table, missing project section, stale workspace list, stale status markers). Full rewrite. Cross-linked into [[concepts/rls-by-default]] and [[concepts/ley-fintech-compliance]].

**Don't do this when:** it's one isolated stale field. A surgical patch is cheaper and lower-risk.

---

### Bonus: outdated agent spec — patch specific sections

**Trigger:** An agent's markdown spec (`agents/core/*.md` or `agents/domain/*.md`) references old paths, tools, or concepts. These are read *before every task* the agent handles.

**Response:** Patch the specific sections that are wrong. Don't rewrite the whole spec — that risks losing well-tuned behavior. Leave a "do not link to X" note at the end if a deprecated link needs retiring.

**Example:** Iter 5 — `agents/core/evolve.md` had 6 staleness issues (wrong memory path, outdated file-based memory approach, missing 2 active projects from Phase 2 list, missing link to cross-project-map as gap source, deprecated mcp-registry link). Patched each section; added explicit "do not link to `learnings/mcp-registry`" note.

## How to pick the right trigger

Ask these three questions in order:

1. **Is there a root cause shared by 2+ symptoms?** → Trigger 1 (concept node)
2. **Is the knowledge scattered as memories with no canonical home?** → Trigger 2 (learnings file section)
3. **Does this file still have its pre-deprecation content?** → Trigger 3 (truncate to pointer)
4. **Is this an auto-generated snapshot that's drifted?** → Trigger 4 (banner)
5. **Is it a registry/map that agents treat as authoritative?** → Trigger 5 (rewrite)
6. **Is it a behavioral spec with specific wrong sections?** → Bonus (targeted patch)

If none match, the trigger probably hasn't fired yet — don't consolidate prematurely.

## Anti-patterns to avoid

- **Appending a correction below outdated content.** Future readers see both and don't know which is current. Rewrite the section instead (CLAUDE.md Vault Plasticity rule).
- **Marking something deprecated and leaving the full content.** Creates drift risk. Either migrate the content out, or delete; don't leave a minefield.
- **Rewriting a file when a banner would do.** Auto-generated snapshots have historical value — banners preserve both history and safety.
- **Banner-ing something that's actively read and acted on.** Registries and agent specs don't get banners; they get fixed.
- **Consolidating one memory.** One is a note, two is a pattern. Wait for the repeat before promoting to a concept.

## Links
- [[CLAUDE]] — Vault Plasticity section
- [[concepts/protocol-enforcement]] — why this work has compounding leverage
- [[agents/core/evolve]] — the agent that runs these triggers during /evolve sessions
- [[learnings/cross-project-map]] · [[learnings/supabase-registry]] · [[learnings/technical]] · [[learnings/patterns]]
