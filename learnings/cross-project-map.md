---
type: learning
tags:
  - cross-project
  - relationships
  - map
updated: '2026-04-17'
---
# Cross-Project Map

This file maps relationships between all projects.
Updated at end of every session when new connections are found.

## Shared Infrastructure

| Resource | Projects | Notes |
|---|---|---|
| Supabase (rycybujjedtofghigyxm) | [[wiki/espacio-bosques]] [[wiki/nutria]] [[wiki/jp-ai]] | eb_, nutria_, ozum_ prefixes. [[concepts/rls-by-default]] enforced. See [[learnings/supabase-registry]] for full table inventory |
| Memory MCP (Supabase `memories`) | ALL | Custom server at `mcp-servers/memory/`. `npm install` required per Codespace (node_modules not committed). The legacy `janus_memories` table was renamed to `_archive_janus_memories_2026_04_28` on 2026-04-28 — only one live table now. |
| Anthropic API | ALL | claude-sonnet-4-6 standard. mercado-bot uses claude-sonnet-4-20250514 for PREDICT step |
| Cloudflare R2 | [[wiki/lool-ai]] [[wiki/longevite]] | janus-media bucket |
| Google OAuth | [[wiki/espacio-bosques]] [[wiki/nutria]] | same Supabase provider |
| dotfiles | ALL | Single source for all keys ([[CLAUDE]] credentials section) |
| Dashboard shell | [[wiki/jp-ai]] [[wiki/mercado-bot]] janus-ia | [[concepts/dashboard-shell]] — 3 deployments proven |

## Shared Legal Exposure

| Law | Projects | Status |
|---|---|---|
| LFPDPPP (facial) | [[wiki/lool-ai]] | ⚠️ Blocker before real users |
| LFPDPPP (health) | [[wiki/nutria]] [[wiki/longevite]] | ⚠️ Flag before real users — both touch patient data |
| LFPDPPP (client CRM) | [[wiki/jp-ai]] | ⚠️ Ozum CRM stores client contacts + deal data — aviso de privacidad required before live |
| Ley Fintech / CNBV | [[wiki/espacio-bosques]] | ✅ Bitso as licensed IFPE ([[concepts/ley-fintech-compliance]]) |
| SAT / CFDI 4.0 | [[wiki/freelance-system]] [[wiki/espacio-bosques]] | freelance: client invoices; eb: RFC validation + CFDI AI analysis already shipped |

## Shared Markets

| Market | Projects | Opportunity |
|---|---|---|
| Polanco/Lomas CDMX | [[wiki/lool-ai]] [[wiki/longevite]] | Store visits = referral potential. [[concepts/relationship-capital-cdmx]] says sequence, don't parallel |
| Bosques de las Lomas | [[wiki/espacio-bosques]] | Community residents |
| Health-conscious 35–60 CDMX | [[wiki/longevite]] [[wiki/nutria]] | Same demographic, different entry — nutria widget can embed on longevite site |
| Corporate Mexico + USA | [[wiki/jp-ai]] | Ozum 30-year relationships; no overlap with CDMX colonia-scoped projects |

## Shared Tech Patterns

| Pattern | Source | Can copy to |
|---|---|---|
| Supabase email+Google auth | [[wiki/espacio-bosques]] ✅ | [[wiki/nutria]] ⬜ (pending schema run) |
| SIMULATION_MODE flag | [[wiki/espacio-bosques]] ✅ [[wiki/mercado-bot]] ✅ | Any future product ([[concepts/simulation-first-dev]]) |
| Bitso MXN→crypto rails | [[wiki/espacio-bosques]] ✅ | Any future MXN product |
| MediaPipe FaceMesh | [[wiki/lool-ai]] ✅ | Any real-time overlay |
| Evidence review + voting | [[wiki/espacio-bosques]] ✅ | Any community/DAO product |
| [[concepts/rls-by-default]] | ALL Supabase tables ✅ | Enforced 2026-04-15 via evolve agent |
| Dark teal theme | [[wiki/espacio-bosques]] [[wiki/mercado-bot]] ✅ | Portfolio-wide dark-variant standard |
| [[concepts/dashboard-shell]] | Venture OS ✅ → Ozum AI-OS ✅ → janus-ia ✅ → mercado-bot ✅ | Any project needing a dashboard |
| oklch accent hue as domain signal | Venture OS (180=tech) → JP AI (85=corporate) ✅ → nutrIA (145) → lool-ai (280) → espacio-bosques (25) | One hue per business domain |
| Test harness before UI | [[wiki/espacio-bosques]] ✅ | [[concepts/test-harness-first]] — enforce on any new backend |

## Known cross-project technical debt

Tracking items that cross project boundaries or have a pattern worth flagging. Update when resolved.

| Item | Project(s) | Blocker level | Notes |
|---|---|---|---|
| `ozum-memory` MCP referenced in CLAUDE.md but NOT in `.mcp.json` → memory is dead code | [[wiki/jp-ai]] | Blocks collective memory | Same fix as janus-ia memory MCP (npm install + wire into .mcp.json) |
| `modules/` directory referenced but doesn't exist | [[wiki/jp-ai]] | Cosmetic | Either create or strip references from CLAUDE.md |
| Supabase `ozum_memories` / `nutria_conversations` / `nutria_patient_profiles` tables not yet created | [[wiki/jp-ai]] [[wiki/nutria]] | Blocks live use | Schemas exist in `database/schema.sql` — run via Supabase MCP |
| Netlify deploy pending | [[wiki/nutria]] [[wiki/longevite]] | Blocks GTM | `NETLIFY_AUTH_TOKEN` in dotfiles required; Netlify MCP ready to activate |
| `tsx watch` stale-route fix not codified as a wrapper script | ALL projects with Express/bridge dev servers | Papercut | See [[learnings/technical]] Dev-environment gotchas |
| Mercado-bot Python backend not yet scaffolded | [[wiki/mercado-bot]] | Blocks real signals | Dashboard runs on mock data |
| espacio-bosques CI all red since Apr 7 | [[wiki/espacio-bosques]] | Blocks demo confidence | Must investigate before first stakeholder walkthrough |
| `.planning/codebase/*.md` snapshots have stale path refs | janus-ia | Low (mitigated 2026-04-17 with STALE banners) | 5 files got a prominent ⚠️ STALE banner on 2026-04-17 explaining the venture-os→janus-ia rename and pointing to canonical sources. Content below the banner is still pre-rename. A full regenerate is the ideal fix but the banner blocks misuse until then |

## Capacity (April 2026)

Active backlog before new projects:
- [[wiki/lool-ai]] — 3D pipeline (3-4 sessions)
- [[wiki/espacio-bosques]] — first demo + CI red fix (1-2 sessions)
- [[wiki/nutria]] — deploy (1-2 sessions)
- [[wiki/longevite]] — deploy (1 session)
- [[wiki/mercado-bot]] — Python backend (2-3 sessions)
- [[wiki/jp-ai]] — CRM Phase 1 (2-3 sessions, revenue-critical) + memory MCP wiring

Operational (no backlog unless a lead comes in):
- [[wiki/freelance-system]] — awaiting first real lead

Total: ~10-14 sessions to clear backlog.
Rule: No new intake until 2 of these are done. See [[concepts/protocol-enforcement]] for why this rule exists and why the AI should flag — not accept — any "just a small new thing" request before clearance.
