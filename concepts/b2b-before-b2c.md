---
type: concept
name: b2b-before-b2c
description: Always validate B2B before adding a B2C layer — B2C requires 20+ B2B clients with proven retention first
tags: [strategy, gtm, b2b, b2c, market, validation]
created: 2026-04-13
updated: 2026-04-13
---

# B2B Before B2C

## The rule
Never build a B2C layer until the B2B layer has 20+ paying clients with proven retention. Trying to serve both simultaneously means serving neither well — different sales motions, different UX, different legal exposure, different pricing.

## The threshold
**20+ B2B clients with retention** before activating B2C or campaigns. This number comes directly from [[wiki/lool-ai]]'s own module spec: "campaigns | deferred — activate at 20+ stores." Below that number, B2B is not yet validated and B2C would dilute focus.

## Portfolio evidence

| Project | B2B layer | B2C risk if skipped |
|---|---|---|
| [[wiki/lool-ai]] | Optical store widget (~1,200 MXN/mo per store) | Consumer try-on requires store catalog — no stores = empty B2C experience |
| [[wiki/espacio-bosques]] | Bosques de las Lomas community (closed HOA-like) | Public marketplace would dilute trust and governance |
| [[wiki/jp-ai]] | Ozum corporate clients (events + travel) | B2C travel marketplace is a completely different product |
| [[wiki/nutria]] | Longevité clinic embed (B2B2C, not direct B2C) | Direct-to-consumer nutrition requires clinical validation |

## What "B2B validated" means
- 20+ paying clients (not free pilots)
- At least 3 months of retention data
- At least one client who referred another
- NPS > 40 from the B2B client base

## Why this matters for Jano
Jano has limited post-3pm hours. Running B2B and B2C sales motions simultaneously would require two different sets of relationships, two different onboarding flows, two different support models — all competing for the same 25 hours/week. The sequencing constraint is as much about capacity as it is about strategy.

## Connected patterns
- [[concepts/cdmx-neighborhood-targeting]] — B2B targets at colonia level; B2C expands from there
- [[concepts/relationship-capital-cdmx]] — B2B relationships in one colonia seed B2C in the same colonia
- [[concepts/poc-before-production]] — validate B2B UX as POC before investing in B2C infrastructure
- [[learnings/patterns]] · [[learnings/market]]
