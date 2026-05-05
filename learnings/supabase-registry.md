---
type: learning
tags:
  - supabase
  - schema
  - registry
  - cross-project
updated: '2026-04-17'
---
# SUPABASE REGISTRY
## All projects share one Supabase instance — tables are prefixed by project name

**Supabase project:** `rycybujjedtofghigyxm.supabase.co`
**Credentials:** `$SUPABASE_URL` + `$SUPABASE_SERVICE_ROLE_KEY` (in [[CLAUDE]] credentials section)
**Convention:** Every project prefixes its tables with `{projectname}_` to avoid collisions.

Per [[CLAUDE]] §SUPABASE, read this file before writing any Supabase query in any project. If you add a new table, add it here in the same commit.

---

## Janus IA — Cross-workspace Memory (`salasoliva27/janus-ia`)

| Table | Purpose | Key columns |
|---|---|---|
| `memories` | **Primary memory table** — every MCP call (`recall`, `remember`, `list_memories`, `capture_*`) reads and writes here. Also what `preflight.sh` and `session-stop-gate.sh` query. | `id`, `workspace`, `project`, `type`, `content`, `metadata` (includes `tags`), `embedding` (vector), `created_at` |
| `_archive_janus_memories_2026_04_28` | Inert archive of 21 rows from the pre-rename era. Renamed 2026-04-28 from `janus_memories` so it can never be confused for the live table again. Do not query, do not migrate. Will be dropped after a few months if nothing references it. | Older/legacy shape |

**Schema file:** `janus-ia/mcp-servers/memory/schema.sql`
**MCP server:** `janus-ia/mcp-servers/memory/` (custom Node server, registered in `.mcp.json`)
**Tools:** `mcp__memory__recall`, `mcp__memory__remember`, `mcp__memory__forget`, `mcp__memory__list_memories`, `mcp__memory__capture_correction`, `mcp__memory__capture_session_summary`
**Install quirk:** `node_modules` not committed → run `npm install` in `mcp-servers/memory/` on every new Codespace. See [[learnings/technical]] Infrastructure findings.
**RLS:** Enabled 2026-04-15 — no policies needed, service role key bypasses. See [[concepts/rls-by-default]].
**Search:** Full-text via `tsvector` + `websearch_to_tsquery` fallback to ILIKE. Semantic search via `$VOYAGE_API_KEY` if set.
**Workspace values (valid):** `janus-ia`, `espacio-bosques`, `lool-ai`, `nutria`, `longevite`, `freelance-system`, `jp-ai`, `mercado-bot`
**Status:** ✅ Live — 30+ rows across types, FIXED 2026-04-16 (npm install was the blocker).

---

## nutrIA (`salasoliva27/nutria-app`)

| Table | Purpose | Key columns |
|---|---|---|
| `nutria_conversations` | Full message history per user (one row per user) | `user_id`, `messages jsonb`, `updated_at` |
| `nutria_patient_profiles` | Structured patient profile extracted from intake | `user_id`, `name`, `age`, `sex`, `weight_kg`, `height_cm`, `bmi`, `goal`, `conditions[]`, `medications[]`, `allergies[]`, `activity_level`, `intake_complete` |

**Schema file:** `nutria-app/database/schema.sql`
**RLS:** Both tables — users can only access their own rows (`(select auth.uid()) = user_id`, subquery form for perf).
**Profile extraction:** Fires at message milestones (8, 16, 24...) using claude-haiku. Stops when `intake_complete = true`.
**Status:** ⬜ Schema not yet run — run `database/schema.sql` in Supabase SQL Editor.
**Legal:** [[concepts/ley-fintech-compliance]] N/A. LFPDPPP (health data) flag before real users.

---

## espacio-bosques (`salasoliva27/espacio-bosques-dev`)

| Table | Purpose | Key columns |
|---|---|---|
| `eb_profiles` | One row per registered user — mirrors auth.users + app fields | `id (uuid→auth.users)`, `display_name`, `full_name`, `neighborhood`, `rfc text UNIQUE`, `rfc_verified bool`, `rfc_status text`, `birth_date date` |

**Schema file:** `espacio-bosques-dev/database/schema.sql`
**Storage doc:** `espacio-bosques-dev/SUPABASE.md`
**RLS:** Users can only read/write their own row (`(select auth.uid()) = id`).
**Architecture note:** Projects/investments/governance/providers live in `backend/sim-data.json` during POC (see [[concepts/simulation-first-dev]]). Migration path documented in SUPABASE.md — Supabase persistent schema intentionally deferred.
**RFC metadata:** `full_name`, `rfc`, `rfc_verified`, `rfc_status`, `birth_date` also stored in `auth.users.user_metadata` for JWT-accessible profile data without a DB round-trip.
**Status:** ✅ Schema ready (applied in dev instance).
**Legal:** [[concepts/ley-fintech-compliance]] — Bitso as licensed IFPE.

---

## jp-ai / Ozum AI-OS (`salasoliva27/jp-ai`) — PENDING

| Table | Purpose | Notes |
|---|---|---|
| `ozum_memories` | Collective memory for Ozum team (same shape as `memories` but Ozum-scoped) | ⬜ Not yet created. Clone the `memories` schema from `janus-ia/mcp-servers/memory/schema.sql`. |
| `ozum_crm_leads` | CRM Phase 1 — lead intake | ⬜ Not yet designed. Revenue-critical for Ozum |
| `ozum_crm_deals` | CRM Phase 1 — deal pipeline | ⬜ Not yet designed |

**Schema file:** TBD (create `jp-ai/database/schema.sql`)
**Blocker:** `ozum-memory` MCP referenced in jp-ai/CLAUDE.md but not wired in `.mcp.json` — memory is dead code until both the MCP is registered AND this table exists. Tracked in [[learnings/cross-project-map]] technical debt.
**Legal:** LFPDPPP (client CRM data) — aviso de privacidad required before live.
**Status:** ⬜ Blocked on schema creation + MCP wiring.

---

## freelance-system (`salasoliva27/freelance-system`) — no tables yet

Currently operational as an automation pipeline with client data likely in local CSV / Google Sheets. If it graduates to a real backend:
- Expected prefix: `freelance_` (e.g., `freelance_leads`, `freelance_proposals`, `freelance_invoices`)
- Add section here when schema is created.

---

## lool-ai, longevite, mercado-bot — no Supabase tables

- **lool-ai** — widget is standalone; product data lives in client's CMS. LFPDPPP concern is facial image data, which should never be persisted server-side. If catalog management lands on Supabase, prefix `lool_`.
- **longevite-therapeutics** — static site, contact form TBD. No tables planned.
- **mercado-bot** — dashboard runs on mock data / local files. If Python backend persists signals or trades, prefix `mercado_`.

---

## Adding a new project's tables

1. Add a section here with table names, purpose, and key columns
2. Prefix every table with `{projectname}_`
3. Enable RLS at creation time with `(select auth.uid()) = user_id` policy (note the `select` wrapper — see [[concepts/rls-by-default]])
4. Commit schema file to the project repo at `database/schema.sql`
5. Update this registry IN THE SAME COMMIT — drift here breaks the "read before query" rule

---

## Access pattern from code

```js
// Always import from shared/lib/supabase.js
import { supabase } from '@shared/lib/supabase.js'

// Query your project's table (prefixed)
const { data } = await supabase
  .from('nutria_conversations')
  .select('*')
  .eq('user_id', userId)
  .single()
```

For server-side code that needs to bypass RLS (admin, migrations, MCP servers), use the service role key and the admin client, NEVER the anon client with RLS policies disabled.

## Links

- [[concepts/rls-by-default]] — RLS policy patterns + performance
- [[concepts/supabase-shared-instance]] — why one instance for all projects
- [[learnings/cross-project-map]] — which projects share infra
- [[learnings/technical]] — Memory MCP npm install quirk
