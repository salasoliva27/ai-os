# LEGAL AGENT — Espacio Bosques
## Jurisdiction: Mexico (Federal + CDMX)

---

## Project summary (legal lens)

Espacio Bosques is a community crowdfunding platform for Bosques de las Lomas residents. Investors pool MXN to fund neighborhood infrastructure projects (security cameras, parks, etc.). Providers (contractors/vendors) are paid via CFDI upon milestone completion. All of this is currently a simulation — no real funds are held.

---

## Applicable law

| Area | Law / Regulator | Status |
|---|---|---|
| Crowdfunding / investment solicitation | Ley Fintech (DOF 2018), CNBV | 🔴 Blocker before real launch |
| Data privacy (investors, providers) | LFPDPPP, INAI | 🟡 Need privacy notice + consent flow |
| Electronic invoicing | SAT CFDI 4.0 | 🟢 Modeled correctly in sim |
| AML / KYC (anti-money laundering) | LFPIORPI, UIF | 🔴 Blocker before real launch |
| RFC validation (providers) | SAT | 🟢 Implemented in sim — real validation requires SAT API |
| Contract with residents (investors) | Civil Code (CDMX) | 🟡 Need standard investment agreement template |
| Contract with providers | Civil Code (CDMX) | 🟡 Need service contract template |

---

## CNBV / Ley Fintech — critical path

Before accepting real funds, Espacio Bosques needs one of:
1. **Institución de Financiamiento Colectivo (IFC)** license from CNBV — for equity or debt crowdfunding
2. **Partnership with a licensed IFC** — white-label the platform under their license

**What this means for the build:**
- Simulation mode buys time. Keep `SIMULATION_MODE=true` in prod until legal structure is validated.
- Never allow real SPEI/card transactions until IFC license or partnership is confirmed.
- Do not use the word "investment" in public-facing copy without legal review — use "participation" or "aportación".

**Estimated cost:** 3–6 months + legal fees (~MXN 200k–500k). Consider CNBV's SANDBOX program first.

---

## SAT / CFDI compliance

The current simulation correctly models:
- RFC format validation (12 chars for personas morales, 13 for personas físicas)
- CFDI UUID generation per transaction
- Provider legal name must match RFC — no aliases

**For production:**
- Real CFDI 4.0 requires a PAC (Proveedor Autorizado de Certificación) — e.g., Facturama, Sat Mexico API
- Provider RFC must be validated against SAT's public RFC lookup (WSDL)
- Retenciones and IVA must be calculated on disbursements

---

## Data privacy

**Investor data collected:** email, name, investment amounts, wallet-equivalent ID
**Provider data collected:** name, RFC, CLABE, business docs

Both are sensitive personal data under LFPDPPP.

**Required before real launch:**
- Aviso de Privacidad Simplificado (on registration screen)
- Aviso de Privacidad Integral (full doc, publicly accessible)
- Explicit consent checkbox on form submit
- Data retention policy (define how long records are kept)
- Security measures documentation (already have Supabase + Codespace isolation)

---

## AML / KYC

Platforms handling money transfers must follow LFPIORPI:
- Identify investors above 6,000 UDIs (~MXN 40k) — full KYC
- File activity reports to UIF for suspicious transactions
- Keep records for 5 years

**For simulation:** No KYC needed. Tag: `SIMULATION_MODE — no real funds`.

---

## Provider RFC — no fake names

Design decision (confirmed by Jano): provider legal name in the system must match their SAT RFC registration. No aliases. This is implemented in `data/providers.ts` via RFC format validation. Real validation requires SAT WSDL lookup — deferred to production.

---

## Templates needed

- [ ] `modules/legal/investment-participation-agreement.md` — resident participation terms
- [ ] `modules/legal/provider-service-contract.md` — contractor agreement template
- [ ] `modules/legal/privacy-notice-simple.md` — aviso de privacidad simplificado (ES)
- [ ] `modules/legal/privacy-notice-full.md` — aviso de privacidad integral (ES)

---

## Open questions

1. Will Jano seek IFC license or partner with an existing platform (e.g., Fondify, Briq)?
2. Is Espacio Bosques structured as an S.A. de C.V. or A.C. (asociación civil)?
3. What is the resident HOA's legal structure — does it already have a fideicomiso?
4. Will the token (ETH representation) be treated as a security or a receipt? This changes CNBV requirements significantly.

---

## Last reviewed: 2026-04-07
## Next review: Before any real payment integration
