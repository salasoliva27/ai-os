---
type: concept
name: poc-before-production
description: Build a throwaway POC to validate core UX before wiring any real infrastructure — save weeks of wasted backend work
tags: [architecture, dev-pattern, validation, poc]
created: 2026-04-13
updated: 2026-04-13
---

# POC Before Production

## What it is
Ship a working proof-of-concept that validates the core user experience before investing in real infrastructure (databases, payment rails, auth, hosting). The POC is intentionally throwaway — its job is to prove the flow works and people want it, not to be production-ready.

## Where it emerged

| Project | POC form | What was deferred |
|---|---|---|
| [[wiki/espacio-bosques]] | Full sim mode — in-memory simStore, no Supabase tables | Persistent DB, real Bitso funds, smart contract deploy |
| [[wiki/lool-ai]] | Standalone demo widget with 5 placeholder frames | Embeddable format, real catalog upload, 3D pipeline |
| [[wiki/nutria]] | V1 PWA + widget bundle built and pushed to GitHub | Supabase schema run, Netlify deploy, Google OAuth |
| [[wiki/longevite]] | Full redesign built and pushed | Netlify deploy, contact form, Google Analytics |

All four reached demo-ready state before any real infrastructure was live.

## Why it works
- Validates UX assumptions before they're baked into a schema or API contract
- Investors and stakeholders see a working product, not a mockup or slide deck
- Bugs in UX flow cost nothing to fix before production; bugs in data model cost weeks
- Forces clarity on what the MVP actually is before you over-engineer it

## The handoff pattern
POC → Production transition always follows the same steps:
1. Keep the API surface identical — only swap the data layer underneath
2. Write the test harness first (`/api/test/*`) before removing sim layer
3. Never go live until [[concepts/test-harness-first]] is fully wired
4. Migrate sim data to seed data for the production DB

## Relationship to other patterns
- Enabled by [[concepts/simulation-first-dev]] — sim mode is what makes POC viable without real infra
- Requires [[concepts/test-harness-first]] before graduating to production
- Pairs with [[concepts/supabase-shared-instance]] — when production is ready, Supabase is already there

## Warning signs you skipped this
- You're writing Supabase migrations before the UI exists
- You're debating auth providers before validating the core user flow
- The first demo requires a live database to work

## Projects
- [[wiki/espacio-bosques]] ✅ POC complete, production pending
- [[wiki/lool-ai]] ✅ POC complete, embeddable widget pending
- [[wiki/nutria]] ✅ POC complete, deploy pending
- [[wiki/longevite]] ✅ POC complete, deploy pending
- [[wiki/mercado-bot]] ✅ Dashboard POC done, Python backend pending
