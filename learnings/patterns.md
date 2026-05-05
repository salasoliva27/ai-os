# PATTERNS — CROSS-PROJECT LEARNINGS
## Last updated: 2026-04-28

> See [[concepts/]] directory for the full abstraction layer — each validated pattern lives there with project evidence and [[links]].

## Related concepts
- [[concepts/spanish-first-mx]] — Spanish-first + MXN pricing validated across all MX projects
- [[concepts/cdmx-neighborhood-targeting]] — colonia-level beats "Mexico City"
- [[concepts/simulation-first-dev]] — build sim layer before real infra
- [[concepts/test-harness-first]] — test harness before UI
- [[concepts/ley-fintech-compliance]] — Bitso as IFPE, LFPDPPP triggers
- [[concepts/supabase-shared-instance]] — one instance, table-prefix namespacing
- [[concepts/rls-by-default]] — RLS on every table, `(select auth.uid())` for performance
- [[concepts/poc-before-production]] — POC validates before persistent infra
- [[concepts/b2b-before-b2c]] — sell to businesses first, consumers later
- [[concepts/relationship-capital-cdmx]] — sequence GTM to avoid network overlap
- [[concepts/protocol-enforcement]] — meta-rule: AI drift toward "ship, skip protocol" and how to resist it
- [[concepts/consolidation-triggers]] — meta-rule: which of the 5 consolidation patterns to apply for each kind of staleness

## Projects feeding this
- [[wiki/espacio-bosques]] · [[wiki/lool-ai]] · [[wiki/nutria]] · [[wiki/longevite]] · [[wiki/mercado-bot]] · [[wiki/jp-ai]] · [[wiki/freelance-system]]

# ORIGINAL PATTERNS — CROSS-PROJECT LEARNINGS

This file captures patterns that repeat across projects. The master agent reads this before every intake to surface relevant knowledge early.

---

## Validated patterns

### Market framing
- "B2B and B2C simultaneously" almost always means neither. Force a choice at intake. The secondary market can come after the primary is validated.
- Mexican SMEs need Spanish-first onboarding and MXN pricing regardless of how global the underlying technology is.
- Mexico City neighborhood-level targeting outperforms generic "Mexico" targeting for local service businesses.

### Build reality
- Dashboard shell is a reusable architecture. Venture OS → Ozum AI-OS adaptation took 1 session with zero structural changes. See [[concepts/dashboard-shell]].
- Multi-agent parallel builds require shared type contracts written FIRST — independent agents inventing types causes 70+ compile errors.
- **Build-first bias** (validated 2x): build sessions produce artifacts but NOT learnings. 113 commits in 30 days, only one /evolve session captured durable knowledge. See [[concepts/protocol-enforcement]].
- **Meta-awareness ≠ behavior change** (2026-04-28): writing `concepts/protocol-enforcement.md` (2026-04-17) added a diagnostic surface (preflight warnings) but did not stop the drift. Eleven days later the same warnings fired: 4-day memory gap, 80h-stale anchor, 13 vault notes append-only. **Diagnostic is not corrective.** The corrective action is changing the trigger that produces behavior — e.g. making `mcp__memory__remember` always-available so the LLM has no fallback excuse, and auto-installing skills so registry/disk drift can't accumulate.
- **MCP availability is load-bearing** (2026-04-28): the inline-capture protocol assumes `mcp__memory__*` tools exist. When `.mcp.json` declared the memory server as HTTP-supervised-by-bridge but the bridge didn't start it, the LLM silently fell back to file-only memory. Stdio-spawned MCPs decouple tool availability from any other process. Switched memory MCP to stdio in commit-of-the-day.

### GTM reality  
- No data yet — will populate as projects reach GTM phase.
- lool-ai and freelance-system are closest to GTM. Upwork has active demand for Claude Code specialists at $1,200-$1,500 per project.

### Timing
- Post-3pm constraint means ~2-3 hour sessions. A full dashboard build fits in 1 session. A CRM Phase 1 is estimated at 2-3 sessions.
- Portfolio backlog as of 2026-04-15: 10-14 sessions across 6 active projects. Rule: no new intake until 2 are cleared.

---

## Validated patterns (2026-04-13 self-improvement session)

Each pattern below was cross-verified against at least 2 project repos and the vault. Full abstraction lives in `concepts/`.

### [[concepts/poc-before-production]]
**Rule:** Ship a throwaway POC that validates core UX before wiring any real infrastructure.
**Evidence:** All 5 active projects (espacio-bosques, lool-ai, nutria, longevite, mercado-bot) reached demo-ready state before any Supabase tables, payment rails, or auth providers were live.

### [[concepts/b2b-before-b2c]]
**Rule:** Never build a B2C layer until the B2B layer has 20+ paying clients with proven retention.
**Evidence:** Confirmed from lool-ai GitHub repo — "campaigns | deferred — activate at 20+ stores" is hardcoded in the module spec. espacio-bosques would dilute community trust if opened to a public marketplace before the HOA layer is stable.

### [[concepts/relationship-capital-cdmx]]
**Rule:** Referral chains in CDMX are colonia-scoped — a warm intro in Polanco does not reach Condesa without a separate bridge. Never run GTM for two projects in overlapping colonias simultaneously.
**Evidence:** lool-ai (Polanco optical stores) and longevite (Lomas Virreyes clinic) share the same Polanco/Lomas geography and the same Jano personal network. Running both GTMs simultaneously burns the same relationship capital for different asks.

### [[concepts/simulation-first-dev]]
**Rule:** Build a full simulation layer (in-memory store, sim auth, fake transactions) before touching real infrastructure.
**Evidence:** espacio-bosques ran fully in sim mode (simStore, fake Bitso, no Supabase tables) through the entire POC phase. mercado-bot dashboard was verified against mock data before any Python backend existed.

### [[concepts/test-harness-first]]
**Rule:** Wire `/api/test/*` endpoints before building any UI that depends on that data. Never rely on manually created state in tests.
**Evidence:** espacio-bosques test harness caught 5 silent bugs (delete 404, save silent-fail, ghost drafts, finalize 422, early threshold) that the UI showed as working because UI optimistically updated.