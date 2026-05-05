---
type: concept
name: supabase-shared-instance
description: All portfolio projects share one Supabase instance with table-prefix namespacing — reduces cost and ops overhead
tags: [architecture, infrastructure, supabase, database]
created: 2026-04-02
updated: 2026-04-13
---

# Supabase Shared Instance

## The pattern
All projects use the same Supabase project (`rycybujjedtofghigyxm`). Tables are prefixed per project to avoid collisions. One set of credentials, one dashboard to monitor, one billing line.

## Table prefix registry
See [[learnings/supabase-registry]] for full schema details.

| Prefix | Project |
|---|---|
| `eb_` | [[wiki/espacio-bosques]] |
| `nutria_` | [[wiki/nutria]] |
| `janus_` | janus-ia (cross-project memory) |
| `ozum_` | [[wiki/jp-ai]] (to be created) |

## Auth sharing
Google OAuth and email/password auth are shared at the Supabase level. This means:
- A user who signs up for espacio-bosques has a Supabase auth record in the shared instance
- Cross-product SSO is possible in the future (same Supabase project = same auth namespace)

## When to add a new project
1. Read [[learnings/supabase-registry]] first
2. Add tables with the new project prefix
3. Update the registry with the new prefix and schema file location
4. Never store secrets directly in any project repo — all credentials come from dotfiles

## Connected patterns
→ [[concepts/simulation-first-dev]]
→ [[concepts/rls-by-default]] — every table must have RLS enabled (enforced 2026-04-15)
→ [[learnings/supabase-registry]]

## Projects
- [[wiki/espacio-bosques]] ✅ eb_ tables live
- [[wiki/nutria]] ⬜ schema written, not yet run
- [[wiki/jp-ai]] ⬜ ozum_ tables pending
