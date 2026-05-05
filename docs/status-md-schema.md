# `.janus/status.md` schema

Each repo Janus manages exposes its current state in `.janus/status.md`. The
bridge reads this file (via the GitHub API, using the token that owns the
repo) and renders it on the project tile + calendar.

The `Calendar` section is **auto-managed by Janus** — it gets rewritten by the
scheduler on every refresh. Edit it through the dashboard's calendar UI, not
by hand. Everything else is owned by you (or by an AI agent committing on
your behalf).

## File location

`.janus/status.md` at the repo root. The `.janus/` directory is the place for
Janus tooling artifacts; keeping `STATUS.md` out of the repo root avoids
cluttering it for human contributors who don't know about Janus.

## Format

```markdown
---
status: active            # active | paused | done | archived
stage: dev                # idea | dev | uat | prod
phase: "API integration"  # short label of the current chunk of work
phaseProgress: 0.4        # 0..1, how far through the phase
summary: One-line description of what this project does and why it matters.
owner: "@you"             # optional — handy when collaborators show up
---

## Next Steps

<!-- Add tasks here. Janus aggregates these across all repos and slots them
     into the calendar without overlap. Format:
       - [ ] [P1, 2h] Task title
     Priority: P1 (urgent), P2 (default), P3 (nice-to-have).
     Effort: hours (e.g. 30m, 2h, 1d). 1d == 6h of focused work.
     Check the box ([x]) when done — Janus will move it to Milestones on next sync. -->

- [ ] [P1, 2h] Wire product catalog
- [ ] [P2, 4h] Build order flow
- [ ] [P3, 1h] Set up linting

## Milestones

<!-- Significant moments. Newest first. ISO date — short description. -->

- 2026-04-15 — Streaming wrapper landed
- 2026-03-30 — Authentication live
- 2026-03-12 — Project kickoff

## Calendar

<!-- AUTO-MANAGED by Janus — do not edit by hand. Generated from Next Steps
     above + the global scheduler. To reschedule, drag the event in the
     dashboard calendar (changes round-trip back here). -->

- 2026-04-29 15:00–17:00 — Wire product catalog
- 2026-05-02 10:00–14:00 — Build order flow
```

## Field reference

### Frontmatter

| Field | Type | Required | Notes |
|---|---|---|---|
| `status` | `active \| paused \| done \| archived` | yes | `archived` is hidden from the constellation by default. |
| `stage` | `idea \| dev \| uat \| prod` | yes | Drives the stage icon on the tile. |
| `phase` | string | yes | Short label, ≤60 chars. Shows under the project name. |
| `phaseProgress` | number 0–1 | yes | Drives the progress bar. |
| `summary` | string | yes | One sentence. Shown on the tile and in the drill-down. |
| `owner` | string | no | GitHub handle or name; not yet rendered. |

### `## Next Steps`

Markdown checkbox list. Each line:

```
- [ ] [<priority>, <effort>] <task title>
```

- `priority`: `P1`, `P2`, `P3`. Defaults to `P2` if omitted.
- `effort`: `30m`, `2h`, `1d` (1d = 6h focused work). Defaults to `2h`.
- `[x]` instead of `[ ]` marks the task as done — Janus will:
  - Remove it from `Next Steps` on next sync.
  - Append it to `Milestones` with today's date.
  - Drop it from the calendar.

### `## Milestones`

Plain bulleted list, newest first:

```
- YYYY-MM-DD — <short description>
```

### `## Calendar` (auto-managed)

The scheduler regenerates this section on every refresh. Each entry:

```
- YYYY-MM-DD HH:MM–HH:MM — <task title>
```

Don't edit by hand. To reschedule, click the event in the dashboard calendar
and use the edit dialog — your changes get written back here.

## Scheduler rules (overview)

- One task slot per day per project, by default.
- Tasks ordered by `priority` (P1 > P2 > P3), then by appearance order in the
  file.
- Default working window: 15:00–20:00 local time, Mon–Fri. Saturdays are
  treated as overflow; Sundays are skipped.
- An event is only scheduled if `status` is `active`.
- Overlap-free: the scheduler never assigns two events to the same hour
  block (across all projects).

## Bootstrap

Janus can generate a starter `.janus/status.md` for any repo that doesn't
have one. The file lands as a draft — you review/tweak/commit (Janus opens a
PR by default, or commits directly if you opt in per repo). Once the file
exists, the project tile lights up with real data.
