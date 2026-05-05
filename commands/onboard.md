---
description: "User onboarding — interview the user once, tailor the Janus instance to them"
argument-hint: "[empty | resume | status | restart]"
---

# /onboard — User Onboarding

You are entering **onboarding mode** — a conversational interview that
turns this generic Janus instance into THIS user's Janus.

This is different from `/intake` (validating new ideas). Onboarding
profiles the human user once. Intake validates ideas every time one
comes up.

## Parse Arguments

The user invoked `/onboard $ARGUMENTS`.

- **empty / no args**: detect state, then either start fresh or offer to
  resume an existing partial intake
- **`resume`**: read the latest YAML from
  `outputs/onboarding/<instance>/` and continue from the last incomplete
  block
- **`status`**: read the YAML, report which blocks are done and which
  remain, do NOT enter interview mode
- **`restart`**: archive the existing YAML (rename
  `intake_v1_<old-date>.yaml` → `intake_v1_<old-date>.archived.yaml`)
  and start fresh

For `<instance>`, use the basename of the current working directory
(e.g. `janus-ia`, `pablo-ia`, `jp-ai`, `ai-os`).

## Before Starting

1. Read `agents/core/onboarding.md` — your full behavioral specification.
2. Read `concepts/onboarding-interview.md` — the 12-block question
   template you'll run through.
3. Read `concepts/onboarding.md` only if you need design rationale.
4. Glance at `wiki/<self>.md` and `CLAUDE.md` — clues about whether the
   user is already partially set up.

## Initialize (new session only)

Create `outputs/onboarding/<instance>/` if needed. Write initial YAML:

```yaml
instance: <repo basename>
started_at: <ISO_TIMESTAMP>
last_updated_at: <ISO_TIMESTAMP>
detected_language: null            # filled in after first user reply
status: in_progress
current_block: 1
blocks: {}
debrief: {}
```

Then deliver the opening line from
`concepts/onboarding-interview.md` in your best language guess, and
listen.

## During the Interview

Follow the rules in `agents/core/onboarding.md` Phase 3:

- Conversational, never form-style. One question at a time.
- Match the user's language from their first reply onward.
- Don't strict-order the blocks — follow the user's energy.
- After every completed block, **persist** by Read+merge+Write the YAML
  with the new block's `raw_responses` and `notes`.
- Time-check every ~3 blocks: ask if they want to keep going or pick up
  later. Some users finish in 60 min; some take 3 hours across multiple
  sessions. Either is fine.

## When Interview Ends (or user stops)

Run Phase 5 (Synthesize) from `agents/core/onboarding.md`:

1. Fill in the YAML `debrief` section from the raw responses.
2. Propose file changes ONE AT A TIME. For each:
   - Print proposed content
   - Ask: "ok to write this to `<path>`? (yes / no / edit)"
   - On `yes`: Write the file. On `no`: skip + note in YAML. On `edit`:
     accept the user's corrections and re-prompt.
3. Synthesis order: `wiki/<self>.md` → `CLAUDE.md` patch → `.mcp.json`
   patch list → `.janus/window-set.yaml` → `agents/.enabled.yaml`.
4. Update YAML `status: complete`.
5. Append Milestone to `.janus/status.md`.
6. Closing message: "you're set. Open Janus next time and your windows
   will be live. Run `/onboard` again to update."

## Critical Rules

- **You're a journalist until Phase 5.** Don't pitch the dashboard,
  agents, or "what we're going to build" during the interview. Listen.
- **Per-file confirmation in synthesis.** Never write multiple files
  without explicit "yes" for each. Especially `CLAUDE.md`.
- **Never write credentials.** `.mcp.json` patches use placeholders;
  surface a checklist of tokens for the user to add manually.
- **Persist after every block.** If the chat dies mid-flow, `/onboard
  resume` must be able to pick up cleanly.
- **Don't auto-trigger.** Onboarding only runs when the user invokes
  `/onboard`. (First-boot detection is a v1.5 nicety, not v1.)

## Reporting

After Phase 5 completes, report a concise summary:

```
**Onboarding Complete — <instance>**
- Detected language: <e.g. es-MX>
- Profile: <one-line job summary from debrief>
- Files written: <count> / <proposed>
- Skipped: <list with reasons>
- Token checklist: <count> MCPs need tokens — see `.mcp.json` comments
- Next: <one suggestion based on their pains, e.g. "schedule the daily
  Reece pull job">
```
