# TECHNICAL LEARNINGS — BUILD TIME REALITY
## Last updated: 2026-04-15

## Related concepts
- [[concepts/simulation-first-dev]] — the most impactful build pattern found so far
- [[concepts/test-harness-first]] — /api/test/* before UI: caught 5 silent bugs in espacio-bosques
- [[concepts/supabase-shared-instance]] — shared infra pattern saving ops overhead
- [[concepts/rls-by-default]] — enable RLS on every table, use `(select auth.uid())` for performance
- [[concepts/dashboard-shell]] — reusable dashboard architecture, proven across 2 projects

## Projects with build data
- [[wiki/espacio-bosques]] — POC in ~7 sessions (React + Supabase + Bitso + governance)
- [[wiki/lool-ai]] — MediaPipe + Three.js in ~2 sessions
- [[wiki/mercado-bot]] — dashboard v1 in ~2 sessions
- [[wiki/jp-ai]] — Full dashboard (46 files, 13,527 lines) in 1 session, adapted from Venture OS

### Estimates vs reality
- React dashboard from scratch: ~5 sessions (Venture OS evidence)
- React dashboard adapted from shell: **1 session** (JP AI evidence — [[concepts/dashboard-shell]])
- Solidity/Hardhat: 450-line smart contract with 22 tests took approximately [TBD] hours

### Stack-specific notes
- **React + Vite + TypeScript strict**: The dashboard shell compiles and builds in <3 seconds via Vite. Production bundle: ~418KB JS + 57KB CSS (gzip: 129KB + 9KB).
- **Multi-agent parallel builds**: When 6 agents write files simultaneously, TypeScript types MUST be established first as a shared contract. Independent type invention causes 70+ compile errors. See [[concepts/dashboard-shell]] adaptation checklist.
- **Express 5 syntax**: Uses `app.get('/{*splat}')` for SPA fallback — different from Express 4. Must use this for any new bridge server.
- **oklch color space**: Accent hue alone signals business domain. Hue 180=tech, 85=corporate, 145=health, 280=optical. See tokens.css in any dashboard.

### Dev-environment gotchas (trip-and-fall reality)

These are concrete operational snags that have bitten ≥ 1 build session. Read before debugging "why doesn't X work in dev":

- **tsx watch does NOT always hot-reload route changes.** If a route returns the global 404 (`{"error":"Not found"}`) but IS defined in the source file, the running process has a stale version. Fix: `lsof -ti :<port> | xargs kill -9 && cd backend && npx tsx src/index.ts &`. Always test a known-good endpoint after restart to confirm the server actually came back. Originally bit espacio-bosques backend (memory 2b327751).
- **Codespace port forwarding requires binding to `0.0.0.0`, not `localhost`.** This applies to Vite (`server.host: '0.0.0.0'`) AND any Express/custom bridge. Without it, ports appear "available" in the Codespace UI but return connection refused from the browser. Applies to dashboard bridge, all project dev servers, and the brain-viewer tool. Originally bit the dashboard work (memory c017fc55).
- **GSAP `from()` + CSS `opacity: 0` = invisible content bug.** When an element has a CSS class like `.fade-in { opacity: 0 }` AND `gsap.from({opacity: 0, ...})`, GSAP animates FROM 0 TO the CSS computed value which is also 0 — so the element never appears. Fix: use `gsap.fromTo()` with explicit to-state, OR remove the CSS initial opacity and rely purely on GSAP. Originally bit Longevité landing (memory 34c2bdb7).
- **Dashboard serves from `dist/`** — after any frontend source change you must `cd frontend && npx vite build` before the dashboard picks up the change. Serving the source dir directly will not work.
- **MCP disconnects are permanent per session.** If an MCP tool crashes or is killed mid-session, it does NOT reconnect. Requires `/compact` or a new session. Never kill an MCP process mid-session to "free memory" — the cost is losing that tool for the rest of the conversation.

### Infrastructure findings (2026-04-15 evolve session)
- **Supabase RLS**: `janus_memories` had NO RLS — fully exposed to PostgREST. Fixed via migration. Rule: every table gets RLS at creation time, even service-role-only tables.
- **RLS performance**: `auth.uid()` in policies re-evaluates per row. Use `(select auth.uid())` to evaluate once as subquery. Fixed 4 policies across eb_ and nutria_ tables.
- **npm audit**: `mcp-servers/memory/` had 3 vulnerabilities (hono, path-to-regexp). Fixed with `npm audit fix`.
- **Dependabot**: Was DISABLED on all 6 repos. Enabled alerts + auto-fix PRs across portfolio.
- **Memory MCP v2**: Rebuilt 2026-04-16 with 6 tools (remember, recall, forget, list_memories, capture_correction, capture_session_summary) and 7 types (session, decision, learning, outcome, correction, feedback, pattern). ilike fallback when full-text search returns nothing.
- **Obsidian vault MCP**: Path fixed 2026-04-16 to `/workspaces/janus-ia`. BUT: still partially broken — read_note/search_notes fail on existing files, list_directory crashes on symlinks. @bitbonsai/mcpvault v0.11.0 doesn't handle project repos well. **Workaround: use direct file reads/writes.** The vault IS the filesystem.
- **Memory MCP dependencies**: node_modules not committed for `mcp-servers/memory/`. Must run `npm install` on every new Codespace. Add to Codespace postCreateCommand or document clearly.
- **MCP disconnects are permanent per session**: If an MCP tool crashes or is killed, it disconnects from the current session and does NOT reconnect. Requires `/compact` or new session. Don't kill MCP processes mid-session.
- **React Flow (@xyflow/react)**: Excellent for interactive procedure/workflow diagrams in React. v12+, ~50KB gzip. Built-in zoom/pan/minimap/controls. Custom node types with Handle components for edges. Used for dashboard ProcedureMap. Production bundle increased from ~418KB to ~605KB.
- **CI**: espacio-bosques GitHub Actions Tests workflow ALL RED since Apr 7. Must investigate before demo.
- **Skills ceiling**: 127 skills installed (36 marketing, 87 GSD, CKM, GSAP, ui-ux-pro-max, cost-mode, excalidraw). No more high-value skills found — current tooling is comprehensive.

---

# GTM LEARNINGS — OUTREACH REALITY
## Last updated: 2026-03-16

### What outreach approaches worked
No data yet. Will populate as lool-ai and freelance-system run GTM.

### Response rates by channel
No data yet.

### Mexico City neighborhood notes
No data yet — will populate as lool-ai visits stores.