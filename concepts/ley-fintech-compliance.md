---
type: concept
name: ley-fintech-compliance
description: Any product moving real money in Mexico must use a licensed IFPE (Bitso) or SOFOM — self-licensing takes 18+ months
tags: [legal, fintech, mexico, compliance, ley-fintech]
created: 2026-04-06
updated: 2026-04-13
---

# Ley Fintech / CNBV Compliance

## The constraint
Mexico's Ley Fintech (2018) requires any entity that holds, moves, or intermediates funds to be licensed by CNBV as an IFPE (Institución de Fondos de Pago Electrónico) or similar. Self-licensing takes 18+ months and significant capital requirements.

## The solution: partner with a licensed IFPE
Use [[wiki/espacio-bosques]]'s pattern: integrate Bitso as the licensed IFPE. Bitso holds the license; the product is the UI layer on top. This is the fastest path to legal compliance for any MXN-moving product.

## Where this applies in the portfolio
- [[wiki/espacio-bosques]] ✅ Bitso sandbox integrated, Ley Fintech satisfied via IFPE partnership
- Any future product that moves MXN must replicate this pattern before handling real funds

## LFPDPPP — separate but adjacent
The Ley Federal de Protección de Datos Personales en Posesión de los Particulares (LFPDPPP) applies when collecting personal data:
- [[wiki/lool-ai]] ⚠️ BLOCKER — collects facial image data, requires privacy notice + consent before any real users
- [[wiki/nutria]] ⚠️ FLAG — collects health data, same requirement

## SAT / CFDI 4.0
Any B2B commercial transaction in Mexico legally requires an electronic invoice (CFDI 4.0). RFC validation and CFDI generation are needed for:
- [[wiki/freelance-system]] — client invoices
- [[wiki/espacio-bosques]] — contractor payments to providers

## Connected concepts
→ [[concepts/spanish-first-mx]]
→ [[concepts/cdmx-neighborhood-targeting]]
→ [[learnings/cross-project-map]]
