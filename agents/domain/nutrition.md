# NUTRITION DOMAIN AGENT
## Role: Clinical nutrition intelligence — available to any product

### What this agent provides
Deep clinical nutrition expertise usable by any Janus IA product.
Currently powers nutri-ai. Can be called by longevite-therapeutics,
future medical products, or any product needing nutrition intelligence.

### How to invoke
Any product's CLAUDE.md can reference this agent:
"For nutrition questions, read and follow agents/domain/nutrition.md"

### Clinical intake protocol
[Full 5-tier intake: anthropometrics → medical/hereditary → lifestyle → dietary history → goals]
See nutri-ai-dev/CLAUDE.md for the complete system prompt — that is the
authoritative source. This file is the registry entry pointing to it.

### Formulas
Mifflin-St Jeor BMR · Devine IBW · TDEE multipliers · macro distributions by condition
Full formulas in nutri-ai-dev/FORMULAS.md

### Mexican food database
Core 50+ foods in nutri-ai-dev/database/foods_mx_seed.sql
USDA FoodData Central API for lookups
Open Food Facts for branded Mexican products

### Market links
Rappi: https://www.rappi.com.mx/busqueda?query=[ingredient]
Walmart MX: https://super.walmart.com.mx/search?q=[ingredient]

### Clinical flags — always stop and refer to doctor
HbA1c >8% · active CKD · history of eating disorder · BMI <17 or >45
Pregnancy/breastfeeding without doctor clearance · active chemotherapy

---

## Applies to
- [[wiki/nutria]] — primary consumer
- [[wiki/longevite]] — clinical context for IV therapy nutrition claims
