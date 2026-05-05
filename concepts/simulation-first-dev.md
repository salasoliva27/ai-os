---
type: concept
name: simulation-first-dev
description: Build a full simulation layer before any real infrastructure — enables demos, testing, and investor pitches without backend dependencies
tags: [architecture, dev-pattern, testing, demo-readiness]
created: 2026-04-06
updated: 2026-04-13
---

# Simulation-First Development

## What it is
Build a complete simulation layer (`SIMULATION_MODE=true`) that mimics all real-world behavior before wiring any real infrastructure. The app is fully functional — you can demo it, test it, and iterate on it — without Supabase tables, real payment rails, or live APIs.

## Where it emerged
First applied in [[wiki/espacio-bosques]] (2026-04-06) when Bitso sandbox + Supabase persistence were deferred. The POC ran entirely in a shared in-memory `simStore`. Full deposit → invest → governance → evidence review flow was demoable with zero real infrastructure.

Applied again in [[wiki/mercado-bot]] (2026-04-08): `SIMULATION_MODE` hardcoded — live trading locked. Dashboard fully functional, showing P&L, signals, Kelly sizing, all simulated.

## Why it works
- Cuts demo-readiness time by ~80%
- Forces you to define the exact data shape and API contract before the real infra exists
- Test endpoints (`/api/test/*`) become the scaffolding that makes the switch to real infra painless
- Investors and stakeholders see a working product, not a mockup

## Requirements for this pattern to hold
- Must have a test harness from day 1: seed endpoints, reset endpoints, state dump
- `SIMULATION_MODE` env flag must be respected everywhere — never bleed sim behavior into prod
- When switching to real infra, replace the simStore layer only — don't touch the API surface

## Connected patterns
→ [[concepts/test-harness-first]]
→ [[concepts/env-flag-architecture]]

## Projects using this
- [[wiki/espacio-bosques]] ✅ full sim mode
- [[wiki/mercado-bot]] ✅ sim mode hardcoded (regulatory)
- [[wiki/lool-ai]] ⬜ no sim layer yet — worth adding before store pilots
- [[wiki/nutria]] ⬜ no sim layer yet
