---
type: adapter
project: janus-ia
tags: [claude-code, adapter, brain-loader]
updated: 2026-04-28
---
# Claude Code Adapter

Claude Code auto-loads `CLAUDE.md`, so this file must exist. It is not the
Janus brain.

Read `AGENTS.md` first. `AGENTS.md` is the canonical Janus IA brain, agent
registry, tool contract, MCP contract, and engine-switching protocol.

Rules for this adapter:

- Do not add general Janus behavior here.
- Do not duplicate agent descriptions here.
- Keep Claude-specific auth, hook, or CLI notes here only when they cannot live
  in the provider-neutral `AGENTS.md`.
- Treat all MCP tools and credentials as brain-level capabilities sourced from
  `.mcp.json` and dotfiles-loaded environment variables.
