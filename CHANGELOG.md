# CHANGELOG
## Janus IA

### 2026-04-03 — V2 Janus IA full restructure

Architecture:
- Brand: Janus IA (was Venture OS). Repo: janus (was venture-os). Org: janus-ia.
- Dispatch protocol added: every request routes through the right agent
- Agents reorganized into core/ and domain/ hierarchy
- 3 new core agents: deploy.md, research.md, ux.md
- 1 new domain agent: nutrition.md (centralizes nutri-ai clinical knowledge)

New systems:
- tools/registry.md — single source of truth for all MCP tools (merged from learnings/mcp-registry.md)
- skills/registry.md — all skills with verdicts and install paths
- outputs/ — all non-code outputs with automatic version control
- dump/ — inbox for files, auto-routed to right place
- portfolio/ — Janus IA product showcase
- docs/ — runbooks and how-to guides
- projects/dev/, projects/uat/, projects/prod/ — deployment tracking

Cleanup:
- Longevite screenshots moved to outputs/screenshots/longevite-therapeutics/
- nutriaai_prompt.md moved to outputs/documents/nutria-app/nutriaai_prompt_V1_20260325.md
- notebooklm/ folder: sources moved to dump/, automation script to tools/configs/, folder removed
- NotebookLM registered as UNTESTED HIGH PRIORITY in tools/registry.md

NotebookLM: classified as tool (MCP), owned by research agent

---

### 2026-03-25 — V2 Tools and Skills overhaul
- TOOLS.md rebuilt with dynamic MCP and skill discovery protocols
- Added claude-skills-mcp for semantic skill search from inside sessions
- Added Claude Code built-in MCP Tool Search (lazy loading, 95% context savings)
- learnings/mcp-registry.md restructured into three sections: MCP Tools, Skills, Project Assessments
- 16 new MCP tools documented including Cowork computer use (released March 24 2026)
- 15 new skills documented including feature-dev (89k installs), gstack, /batch, /code-review
- CLAUDE.md updated: Tools/Skills distinction clarified, registry feedback added to session end protocol

### 2026-03-16 — V1 Initial build
- Master repo created with full agent architecture
- Eight agents defined: intake, legal, financial, calendar, performance, trickle-down, developer (+ project agent per repo)
- Module library created: validation, build, gtm, campaigns, performance, learnings, financial, legal
- Three projects registered: freelance-system, lool-ai, espacio-bosques
- Learning database seeded with validated patterns from design sessions
- Storage strategy defined: GitHub + Google Drive 2TB + Cloudflare R2
- Dotfiles configured for automatic credential propagation across all repos
- freelance-system registered and updated with janus reporting protocol