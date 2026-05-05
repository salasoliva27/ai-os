---
description: "Self-improvement loop — memory consolidation, tool discovery, capability upgrades"
argument-hint: "[DURATION] (e.g., 30m, 1h) | continue | status"
---

# /evolve — Self-Improvement Mode

You are entering **evolve mode** — a timed self-improvement loop where you make yourself better at serving Jano's venture portfolio.

## Parse Arguments

The user invoked `/evolve $ARGUMENTS`.

- If `$ARGUMENTS` is a duration (e.g., `30m`, `1h`, `45m`): start a new evolve session with that time budget
- If `$ARGUMENTS` is `continue`: read `.planning/evolve/handoff.md` and resume from where the last session left off
- If `$ARGUMENTS` is `status`: read `.planning/evolve/state.json` and `.planning/evolve/log.md`, report current state
- If `$ARGUMENTS` is empty: default to `30m`

## Before Starting

1. Read `agents/core/evolve.md` — this is your full behavioral specification
2. Read `.planning/evolve/state.json` if it exists — check for prior state
3. If `continue` mode: read `.planning/evolve/handoff.md` and resume

## Initialize (new session only)

Create `.planning/evolve/` directory if needed. Write initial `state.json`:

```json
{
  "session_id": "evolve_[ISO_DATE]",
  "started_at": "[ISO_TIMESTAMP]",
  "time_budget_minutes": [PARSED_DURATION],
  "iteration": 0,
  "status": "running",
  "checked_sources": [],
  "discoveries": [],
  "installed": [],
  "queued": [],
  "gaps_identified": [],
  "memories_updated": [],
  "next_priorities": []
}
```

## Each Iteration Cycle

Run these five phases in sequence. Each cycle should take 3-5 minutes.

### Phase 1: CONSOLIDATE (20% of cycle)

Strengthen existing memory and knowledge connections:

1. Read memory files in the auto-memory directory
2. Search vault via `mcp__obsidian-vault__search_notes` for patterns across projects
3. Find and fix:
   - Duplicate memories → merge them
   - Patterns that appear in 2+ sessions but aren't recorded as concepts → create concept
   - Stale memories referencing things that no longer exist → remove or update
   - Missing cross-links between related knowledge → add links
4. Update MEMORY.md index if changed

### Phase 2: ASSESS (15% of cycle)

Identify what capabilities are missing or weak:

1. Read `tools/registry.md` and `skills/registry.md`
2. Scan recent session memories for tasks that were:
   - Impossible (no tool existed)
   - Slow (manual work a tool could automate)
   - Repeated (same pattern across sessions that could be systematized)
3. Check active project needs against available tools
4. Produce max 5 prioritized gaps for this cycle

### Phase 3: DISCOVER (30% of cycle)

Search for tools and capabilities that fill the gaps:

1. **GitHub**: `mcp__github__search_repositories` — MCP servers, Claude skills, relevant tools
2. **Web**: `mcp__brave-search__brave_web_search` — awesome lists, blog posts, new releases
3. **Awesome lists**: Search for `awesome-mcp-servers`, `awesome-claude-code`, agent skill repos
4. **Domain-specific**: Based on gaps — legal MX, nutrition, fintech, optical, biotech

Evaluate each find against: relevance to gaps, maintenance status, compatibility, quality, security.

### Phase 4: INSTALL (25% of cycle)

Install the best discoveries (max 3 per cycle):

1. **MCP servers** → add to `.claude/settings.local.json`
2. **Skills** → `npx skills add [url]` or plugin marketplace
3. **Tools** → install via appropriate package manager
4. Test each install works with one basic call
5. Update `tools/registry.md` and/or `skills/registry.md`

**Safety**: Never install paid tools without asking. Never modify project source code. Skip if install takes > 5 min.

### Phase 5: SYNTHESIZE (10% of cycle)

Record and prepare for next iteration:

1. Update `.planning/evolve/state.json` — increment iteration, record work
2. Append cycle summary to `.planning/evolve/log.md`
3. Write significant findings to auto-memory files
4. **Context check**: If context is getting full:
   - Write `.planning/evolve/handoff.md` with full state for next session
   - Tell Jano: "Context is filling up. Start a new session and run `/evolve continue` to pick up where I left off."
   - Stop the loop
5. **Time check**: If time budget is exhausted:
   - Complete this cycle
   - Set `status: "completed"` in state.json
   - Report summary to Jano
   - Stop the loop
6. If time remains: use `/loop` (ScheduleWakeup) to schedule the next iteration

## Loop Scheduling

After each cycle, if time remains, schedule the next iteration:
- Use ScheduleWakeup with the `/evolve continue-cycle` prompt
- Delay: 90-180 seconds depending on what Phase 3 found
  - Found things to install → 180s (give installs time)
  - Only consolidation work → 90s (quick turnaround)

## Reporting

After every 3 cycles, or when the budget expires, report to Jano:
```
**Evolve Report — Cycle N/M**
- Memories consolidated: [count]
- Gaps identified: [list]
- Discoveries: [list with links]
- Installed: [list]
- Queued for next time: [list]
- Time remaining: Xm
```

## Critical Rules

- You are upgrading the SYSTEM, not building product features
- Never touch project source code — only tools, configs, registries, and memory
- Be honest: "found nothing useful" is fine
- Prioritize what helps Jano's active projects over interesting-but-irrelevant tools
- Respect the time budget strictly
- If you can't install something (needs API key, costs money), queue it with a note for Jano
