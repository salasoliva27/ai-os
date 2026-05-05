---
type: brain
project: janus-ia
tags: [brain, engines, agents, mcp, tools, memory, vault]
updated: 2026-04-28
---
# JANUS IA AGENTS

This is the canonical Janus IA brain file. Claude Code, Codex, Gemini, and any
future CLI are engines behind this same brain. No provider owns the system.

`CLAUDE.md` exists only because Claude Code auto-loads that filename. It should
stay a thin compatibility loader that points here. General instructions,
agent descriptions, tool rules, memory rules, and workflow rules belong here.

## Operating Model

- **Brain:** this repo, the filesystem vault, durable memory, agents, workflows,
  MCP tools, skills, dashboard state, and project registries.
- **Engines:** interchangeable processors launched by the dashboard bridge.
- **Adapters:** provider-specific launch flags, auth flows, and config sync.

Switching from Claude to Codex should feel like switching engines in the same
machine, not moving to a different assistant. Native CLI thread IDs are private
adapter state; the dashboard bridge keeps the shared Janus conversation log.

## Shared Substrate

All engines use the same sources:

- `AGENTS.md` — canonical brain and agent contract.
- `.mcp.json` — canonical MCP server registry for the workspace.
- `tools/registry.md` — tool verdicts and install/runtime notes.
- `skills/registry.md` — skill verdicts and installed skill inventory.
- `agents/` — detailed role specs for specialized agents.
- `wiki/`, `concepts/`, `learnings/`, `PROJECTS.md` — filesystem vault.
- Supabase/Neo4j memory MCP — durable cross-engine memory.
- Dotfiles-loaded environment variables — credentials never live in this repo.

Provider-specific files under `.claude/`, `~/.codex/`, or other CLI homes are
adapters. They must mirror or point at this shared substrate.

## Tool Contract

Tools belong to the brain, not to the active model.

- Add workspace MCP tools to `.mcp.json`.
- If a provider needs another config format, generate it from `.mcp.json`.
- Reference credentials as env vars only; Jano's dotfiles load them into the
  Codespace environment.
- Do not paste secrets into repo files, generated provider configs, prompts, or
  logs.
- Log new tool verdicts in `tools/registry.md`.
- Log skill verdicts in `skills/registry.md`.

Current shared MCP/tool surface includes GitHub, Brave Search, filesystem,
fetch, sequential thinking, memory, Snowflake, Context7, Playwright, n8n,
Cloudflare, Obsidian vault, knowledge graph, and Supabase. Codex receives these
through generated `~/.codex/config.toml`; Claude Code reads the workspace
MCP configuration directly.

The dashboard SQL console has its own persistent Supabase and Snowflake bridge
connections. Those UI tools stay available regardless of the selected model.

## Engine Switching

The dashboard bridge owns continuity:

1. Keep one shared Janus conversation log per dashboard session.
2. Store each CLI's native resume/thread id privately by engine.
3. When an engine receives a turn after another engine worked, inject the
   missing shared context into that turn.
4. Keep MCP/tool access sourced from `.mcp.json`.
5. Keep credentials in dotfiles/env.

Claude cannot resume a Codex native thread, and Codex cannot resume a Claude
native thread. That is fine. The shared Janus log and memory layer are the
continuity source.

## Session Behavior

- Work directly in the repo unless the user is only asking a question.
- Preserve unrelated user edits.
- Use the filesystem vault directly when notes or registries need updates.
- Use memory tools when available for durable decisions, corrections, and
  surprising learnings.
- Read relevant agent specs from `agents/` before acting in that role.
- For frontend changes, run the dashboard build.
- For bridge/backend changes, run the dashboard build when feasible.

## Memory Privacy

Memory is shared across engines. Codex runs under a company API key and
reads work data including financial numbers; Claude runs under a personal
profile. To keep work-sensitive content out of the personal profile, no
engine writes sensitive content to shared memory. Storage stays shared; the
discipline lives at the write step.

**What counts as sensitive (do not write to memory):**

- Revenue, costs, P&L line items, runway, payroll, valuations, raw KPIs.
- Client or customer names paired with spend, usage, or contract terms.
- API keys, tokens, credentials, internal URLs, account IDs.
- Health data, identity numbers, addresses, private contact info.
- Anything under NDA or marked internal-only.

**Write protocol — every memory write, no exceptions:**

1. Draft the memory content.
2. Read it back line by line. Ask of each line: *would this be a problem if
   the personal profile read it tomorrow?* If yes, rewrite without the
   number or name, or skip the memory entirely.
3. Add to frontmatter:
   ```
   contains_sensitive: false
   sensitivity_check: <one line — what you scanned for and excluded>
   ```
4. Then write.

If a memory genuinely needs sensitive data (e.g. a debugging detail with a
real account ID), it does not go in shared memory at all. Use a
session-scoped note, or a separate work-only store outside the shared
memory dir.

**Audit:** run `scripts/memory-audit.sh` weekly. It scans the shared memory
dir for known sensitive patterns and missing frontmatter and lists any hits
for review. The audit is a manual safety net, not an enforcement gate — its
job is to catch drift so the rule above stays real.

## Verification

For UI/frontend/API changes, use the UX verification shape in
`agents/core/ux.md`: code review, server start, visual check at desktop/mobile
when relevant, click-through for changed flows, and security review when auth,
data, or external APIs are touched.

## Agent Registry

| Agent | File | Function |
|---|---|---|
| Intake | `agents/core/intake.md` | New idea intake, validation, conflict checks, project spin-up |
| Developer | `agents/core/developer.md` | Architecture, build sequencing, implementation |
| UX | `agents/core/ux.md` | Visual verification, Playwright, design system |
| Legal | `agents/core/legal.md` | Compliance, contracts, regulatory flags |
| Financial | `agents/core/financial.md` | P&L, runway, burn, portfolio view |
| Calendar | `agents/core/calendar.md` | Google Calendar sync and capacity conflicts |
| Performance | `agents/core/performance.md` | Dashboards, metrics, weekly summaries |
| Trickle-down | `agents/core/trickle-down.md` | Cross-project proposal routing |
| Deploy | `agents/core/deploy.md` | Dev to UAT to prod pipeline, tagging, drift checks |
| Research | `agents/core/research.md` | Market research, competitor analysis, data gathering |
| Security | `agents/core/security.md` | Vulnerability review and pre-deploy gates |
| Oversight | `agents/core/oversight.md` | Product coherence, launch readiness, end-to-end gaps |
| Marketing | `agents/core/marketing.md` | Brand, content, campaigns, outreach, video |
| Evolve | `agents/core/evolve.md` | Self-improvement, capability discovery, memory consolidation |
| Nutrition | `agents/domain/nutrition.md` | Clinical nutrition intelligence for nutrIA |

If a domain needs reusable specialized expertise, add a new file under
`agents/domain/` and register it here.

## Adapter Notes

### Claude Code

- Required loader file: `CLAUDE.md`.
- That file must point here and avoid becoming a second brain.
- Anthropic auth/API details are provider-specific and may stay in Claude
  adapter docs or dashboard auth code.

### Codex

- Required loader file: `AGENTS.md`.
- Dashboard launches Codex through `codex exec --json`.
- Dashboard syncs workspace `.mcp.json` into `~/.codex/config.toml`.
- `scripts/codex-mcp-shim.js` lets Codex reuse stdio MCP servers without
  copying secret values into Codex config.

### Snowflake

- Snowflake credentials are env vars from dotfiles.
- `.mcp.json` exposes Snowflake to engines through `scripts/snowflake-mcp`.
- The dashboard SQL console also keeps a persistent Snowflake SDK connection.

## Migration Rule

When a rule is generally true for Janus, write it here or in shared vault files.
Only write provider-specific behavior in provider adapter files when it truly
depends on that CLI.
