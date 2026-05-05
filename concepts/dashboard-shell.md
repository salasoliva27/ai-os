---
type: concept
tags: [architecture, reusable, dashboard, frontend]
created: 2026-04-15
---
# Dashboard Shell — Reusable Architecture

A proven reusable architecture for building project dashboards across the portfolio.

## Pattern
React 18 + Vite + Express 5 + WebSocket bridge + Claude CLI integration. Three-panel resizable layout with:
- Left: Chat panel (Claude session streaming)
- Center: Switchable visualization (Project Grid / Knowledge Brain / Activity Monitor)
- Right: Memory River + Document Preview + File Editor

## Evidence
- **Venture OS** (Janus IA): Built first, ~13,500 lines, 46 files. Cool teal theme (oklch hue 180).
- **Ozum AI-OS** (JP AI): Adapted in one session on 2026-04-15. Same architecture, warm gold theme (oklch hue 85). Zero structural changes needed.

## Adaptation checklist
1. `store.tsx` — Replace projects, agents, tools, learnings, brain graph data
2. `tokens.css` — Change `--color-accent` hue to match business domain
3. `bridge/server.ts` — Update workspace root path, watch directories
4. `ChatPanel.tsx` — Update instance name in header
5. `bridge/claude-session.ts` — Update WORKSPACE_ROOT
6. All event names — Change prefix (venture-os: / ozum-aios: / etc.)

## Connected
- [[wiki/jp-ai]] — first reuse of this pattern
- [[concepts/simulation-first-dev]] — dashboard runs with hardcoded data before real APIs
- [[learnings/patterns]] — cross-project reuse evidence
- [[learnings/technical]] — multi-agent type contract lesson learned during build
