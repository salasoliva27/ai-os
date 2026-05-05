---
type: concept
name: test-harness-first
description: Every backend must have /api/test/* endpoints and a test-api.sh script before any UI work begins
tags: [architecture, testing, dev-pattern, backend]
created: 2026-04-07
updated: 2026-04-13
---

# Test Harness First

## What it is
Before building any UI, wire a `GET /api/test/state` endpoint and a `scripts/test-api.sh` that can exercise the full API flow end-to-end. The test harness is the truth — if the shell script passes, the feature works.

## Where it emerged
Codified during [[wiki/espacio-bosques]] session 2026-04-07g after 5 provider service bugs were found that visual testing missed. The bugs (delete 404, save silent-fail, ghost drafts, finalize 422, early threshold) were all detectable via the test harness but invisible in the UI.

## Standard interface
- `GET /api/test` — self-documenting, lists all test endpoints with curl examples
- `GET /api/test/state` — dump full application state
- `GET /api/test/[feature]` — dump state for a specific feature
- `POST /api/test/[feature]/[action]` — seed or mutate data
- `DELETE /api/test/[feature]/[id]` — delete specific records
- `POST /api/test/reset` — global reset to seed state

## Rules
- Never active in production — mount only when `SIMULATION_MODE=true` or `NODE_ENV=development`
- Always use minimum required values for transactions (e.g. 100 MXN, not arbitrary large numbers)
- `test-api.sh` must support `--state`, `--sim`, `--reset` flags
- Print colored ✓/✗ output per step

## The tsx watch trap
`tsx watch` does NOT always hot-reload. If a route returns `{"error":"Not found"}` but IS defined in source: the running process is stale. Fix: `lsof -ti :3001 | xargs kill -9 && npx tsx src/index.ts &`. Always confirm restart by testing a known-good endpoint first.

## Connected patterns
→ [[concepts/simulation-first-dev]]
→ [[concepts/env-flag-architecture]]

## Projects where applied
- [[wiki/espacio-bosques]] ✅ full test harness
- [[wiki/mercado-bot]] ⬜ dashboard only, no backend harness yet
- [[wiki/nutria]] ⬜ not yet
- [[wiki/lool-ai]] ⬜ not yet
