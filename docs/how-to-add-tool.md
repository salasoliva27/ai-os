# How to add a new MCP tool

1. Check tools/registry.md — already there?
2. Search the MCP registry from any available engine/CLI. Claude Code's
   `claude mcp search "[capability]"` is one adapter option.
3. Filter: stars >100 OR official repo, last commit <6 months
4. Add to `.mcp.json` so every engine receives the same tool surface
5. Add entry to tools/registry.md as UNTESTED
6. Add credentials section to CREDENTIALS.md if needed
7. Test in next session, update verdict
