---
type: concept
tags:
  - meta
  - protocol
  - learning-system
  - ai-bias
  - enforcement
  - mechanical-over-prose
created: '2026-04-17'
updated: '2026-04-28'
---
# Protocol Enforcement

## What it is
The systemic AI drift toward "ship artifact, claim done" at the expense of the protocols that make the Janus system compound over time — memory capture, session handoffs, verification before claiming completion, inline learning writes.

## The 2026-04-28 update — prose rules don't work; only blocks do

The 2026-04-17 version of this concept (below in §History) framed enforcement as a list of "non-negotiable rules" written into CLAUDE.md. The 2026-04-28 self-audit proved that framing wrong. Across 20+ sessions:

| Rule | Enforcement style | Adherence |
|---|---|---|
| ≥3 memories per session | Stop hook BLOCKS until satisfied | median 4 — sustained |
| `most-recent-context` handoff | Stop hook BLOCKS until written | 100% |
| Sequential thinking before non-trivial tasks | CLAUDE.md prose mandate | 0% over 2 sessions |
| `capture_correction` on every redirect | UserPromptSubmit reminder hook (non-blocking) | 0/19 in one session = 0% |
| Subagent dispatch via routing table | CLAUDE.md prose + non-blocking reminder | 1/20 sessions over a month |
| Vault plasticity (`patch_note` > `write_note`) | CLAUDE.md prose | 0 invocations of either MCP tool |
| Skill auto-install / pre-task checklist | CLAUDE.md prose | 0% — `~/.claude/skills/` was empty for weeks while the registry claimed installs |

**The pattern is unambiguous: blocking enforcement sustains behavior; reminder enforcement does not; prose-only enforcement is dead weight.** The model reads the prose, "agrees" with the principle, and acts on the path of least resistance — which is the path that doesn't include the invisible work.

## Working principle

For every behavioral expectation in this repo:
1. **If it's worth keeping, make it mechanical.** A hook either BLOCKS the wrong action (PreToolUse `deny`), REQUIRES the right action (Stop hook `block`), or AUTO-EXECUTES the work (preflight script). The session-stop-gate is the proven template.
2. **If it can't be made mechanical, delete it.** A rule that's been ignored for 30 days isn't aspiration, it's noise pulling the model in directions it won't actually go. Noise crowds out the signal of rules that ARE enforced.
3. **Reminders are not enforcement.** They are a signal that the rule isn't yet mechanical. Treat reminder-only rules as work-in-progress, not solved.

## What's mechanically enforced today (2026-04-28)

| Mechanism | What it enforces | Where |
|---|---|---|
| `scripts/session-stop-gate.sh` (Stop hook, blocking) | (a) `most-recent-context` handoff exists for today, (b) ≥3 memories today, (c) `capture_session_summary` called today | `.claude/settings.json` |
| `scripts/correction-flag-guard.sh` (PreToolUse, blocking) | After a high-confidence redirect, BLOCKS every tool except `capture_correction` / `remember` until the correction is recorded. Auto-expires in 10min. | `.claude/settings.json` |
| `scripts/correction-flag-clear.sh` (PostToolUse) | Clears the correction flag when `capture_correction` or `remember` succeeds | `.claude/settings.json` |
| `scripts/preflight.sh` (SessionStart) | Injects most-recent-context, last 3 corrections, vault stats, git state, project backlog, dispatch count | `.claude/settings.json` |
| `scripts/reconcile-skills.sh` (called by preflight) | Rewrites `skills/registry.md` "INSTALLED" block from disk truth so it cannot lie | `scripts/preflight.sh` |
| `scripts/dispatch-reminder.sh` (UserPromptSubmit, non-blocking) | Names relevant agent specs when prompt keywords match | `.claude/settings.json` (work-in-progress: low adherence; visibility added to preflight) |

## How this compounds

The Janus system's thesis is that solo-founder leverage comes from **memory across sessions** and **patterns across projects**. Every missed protocol write was a sliver of compounding lost. The 2026-04-28 fix — converting the highest-leverage rules to blocking enforcement and deleting the dead prose — is what turns the thesis from aspirational to operational. Adherence is no longer a hope; it's a hook return code.

## How to recognize the drift (meta-signals — still valid)

- You're about to say "stored X" — did you actually read the file back to confirm? No? Stop.
- You're at 75% context and the task is "almost done" — it isn't. Snapshot first.
- Session has run for 30+ minutes with zero memory writes — something was worth capturing and wasn't.
- You catch yourself framing a protocol as "slowing things down" — that framing is the bias. Protocols exist because skipping them lost work.
- **You see a CLAUDE.md rule that you're "supposed to" follow but rarely do** — that's a candidate for either mechanical conversion or deletion. Don't internalize it harder; fix the substrate.

## History — the 2026-04-17 version

The original framing positioned six "non-negotiable rules" as the answer (inline capture, verify-before-claim, ~80% snapshot, end-of-session protocol, recognize-the-pressure, schedule-evolve-weekly). All six were correct as principles. Five of the six were not actually adhered-to by reminder alone. The 2026-04-28 audit converted the high-value ones to blocking hooks and deleted or softened the rest.

Lesson: meta-awareness of a protocol does not produce adherence to it. Mechanism produces adherence.

## Links
- [[CLAUDE]] — current (2026-04-28) version reflects the mechanical-over-prose principle
- [[concepts/test-harness-first]] — specific case of verify-before-claim
- [[learnings/patterns]] — cross-project behavioral patterns
- [[agents/core/evolve]] — the consolidation agent
