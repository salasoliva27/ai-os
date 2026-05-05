---
type: concept
tags: [onboarding, intake, user-profile, customization, downstream-replicas]
updated: 2026-05-05
---
# Onboarding — turning a blank Janus into the user's Janus

Janus is replicated across personal AI workspaces (Alejandro's `janus-ia`,
Pablo's `pablo-ia`, JP's `jp-ai`, the blank `ai-os` template). The brain,
dashboard, and tooling are identical via [[concepts/dashboard-shell]] and
the upstream→downstream sync (`scripts/sync-downstreams.sh`).

What's NOT identical — and shouldn't be — is **who the user is, what they
do, and which tools matter to them.** That's what onboarding produces.

## Why this exists

A fresh Janus instance (especially `ai-os`) opens to chat with no context
about its owner. Without onboarding the user has to:
- Manually populate `wiki/<self>.md` with their profile
- Hand-edit `CLAUDE.md` to reflect their role/language/preferences
- Figure out which `.mcp.json` servers they need
- Decide which dashboard windows are relevant
- Triage which janus agents apply to their work

Most users won't. The dashboard sits unused. **Onboarding is the wedge that
makes a generic Janus instance into "your Janus" in 30-90 minutes.**

## What it is, what it isn't

**Is:**
- A conversational interview (no forms) the user runs once on a fresh
  instance via `/onboard`
- ~12 blocks of depth modeled on the JP/Ozum intake pattern
  (`outputs/documents/jp-ai/intake_interview_V1_2026-04-16.md` — the
  successful manual prototype this generalizes)
- Persisted answers (`outputs/onboarding/<instance>/intake_v1_<date>.yaml`)
  that survive across sessions — `/onboard resume` picks up mid-flow
- A synthesis step that proposes file changes (per-file confirmation)

**Isn't:**
- The "new idea → validated project" flow. That's [[agents/core/intake]] —
  different agent, runs every time the user describes a new idea.
- A one-shot questionnaire. Pace is conversational; the interview can
  span multiple chat sessions; tangents are encouraged.
- An auto-installer. Every file written/MCP added/agent enabled is
  proposed first and waits for explicit "yes."

## Inputs and outputs

```
input
  user's responses across ~12 conversational blocks
  language inferred from first reply (auto-detect)
  any pre-existing wiki/<self>.md or CLAUDE.md customizations

state
  outputs/onboarding/<instance>/intake_v1_<date>.yaml
    block-by-block raw answers + interview metadata + synthesized profile

output (proposed, applied per-file with user yes)
  CLAUDE.md updates                — user info, role behaviors, language
  wiki/<self>.md                   — user's "self" project entry
  .mcp.json patch list             — MCPs that fit tools they mentioned
  .janus/window-set.yaml           — recommended dashboard windows
  agents/<scope>/*.md activations  — which janus agents to keep enabled
```

## Trigger model

- **`/onboard`** — start a new interview (or detect existing state and ask)
- **`/onboard resume`** — read latest YAML, continue from last completed block
- **`/onboard status`** — report progress without entering interview mode
- **First-boot detection (v1.5)** — empty `wiki/`, no `outputs/onboarding/`,
  no customization in `CLAUDE.md` → the chat panel surfaces a system note:
  "Looks like you haven't onboarded — say `/onboard` to begin."

## Why it lives in janus-ia (and propagates)

- Authoring upstream means every replica gets the same interview quality
- The sync (`scripts/sync-downstreams.sh`) propagates `concepts/`, `agents/`,
  `commands/` — onboarding flows naturally to ai-os, pablo-ia, jp-ai
- Per-instance state (`outputs/onboarding/`) is in `never_sync` — Pablo's
  answers don't leak to JP's Janus

## Relationship to existing pieces

- [[agents/core/intake]] — different agent. Onboarding profiles the USER
  once. Intake validates an IDEA each time one comes up. They're orthogonal.
- [[concepts/dashboard-shell]] — onboarding decides which windows the
  shell renders for this user.
- [[concepts/spanish-first-mx]] — onboarding's language auto-detect respects
  the rule (Spanish primary for LATAM users) without forcing it.
- `scripts/sync-downstreams.sh` — the interview mechanism propagates;
  the answers don't.
- `outputs/documents/jp-ai/intake_interview_V1_2026-04-16.md` — the manual
  prototype this generalizes from. Kept as the historical case study.

## Open questions (for v2+)

- Should the agent generate a starter `wiki/<work-area>.md` for each major
  domain the user mentioned (e.g. their employer, their side project)?
  Probably yes — gives the dashboard immediate content to render.
- Should the synthesis include a starter calendar of recurring rituals
  ("you mentioned Monday planning — block it on the dashboard cal")?
  Maybe v2.
- Multi-user instances (jp-ai is multi-user — Ozum employees) need a
  per-user onboarding key. Single-user for v1.
