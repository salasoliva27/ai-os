---
type: concept
tags:
  - security
  - supabase
  - pattern
created: '2026-04-15'
---
# RLS By Default

## What it is
Every table in the shared [[concepts/supabase-shared-instance|Supabase instance]] must have Row Level Security (RLS) enabled, even if only accessed via service role key.

## Why it matters
- Tables without RLS are exposed to PostgREST and accessible via the anon key
- Service role key bypasses RLS automatically, so enabling RLS has zero impact on server-side access
- Forgetting RLS is the #1 Supabase security finding — it's not defense-in-depth, it's basic hygiene

## The pattern
1. **Every new table**: add `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` in the same migration
2. **System tables** (no user_id, accessed only by service role): RLS enabled, zero policies needed
3. **User tables**: RLS enabled + policy using `(select auth.uid()) = user_id` (note the `select` wrapper for performance)
4. **Shared read tables**: RLS enabled + `USING (true)` for SELECT, restricted INSERT/UPDATE/DELETE

## Performance rule
Always use `(select auth.uid())` instead of `auth.uid()` in RLS policies. Without `select`, the function re-evaluates per row. With `select`, it evaluates once as a subquery.

## Discovered
2026-04-15 — evolve agent found `janus_memories` fully exposed (no RLS). Applied fix + optimized 4 existing policies.

## Links
- [[concepts/supabase-shared-instance]]
- [[wiki/espacio-bosques]] — eb_investments, eb_profiles policies
- [[wiki/nutria]] — nutria_conversations, nutria_patient_profiles policies
