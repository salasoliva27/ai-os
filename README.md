# AI OS

Blank-slate AI workspace. On first boot the chat is the only window — say
`/onboard` and the agent will interview you (~60-90 min, conversational, no
forms) to learn what you do, the tools you use, and what would actually
help. From your answers it proposes a CLAUDE.md, a starter wiki entry, an
.mcp.json patch list, a dashboard window set, and an agent activation list
— one file at a time, with `yes / no / edit` per file.

## Run

```cmd
AI OS.cmd
```

(Auto-updates the repo, ensures Node + dependencies, builds the frontend,
opens the dashboard at http://localhost:3100.)

## Origin

Cloned from the upstream Janus IA template (salasoliva27/janus-ia). Brain,
dashboard, and tooling sync periodically via
`scripts/sync-downstreams.sh`. Per-instance state (your wiki, your
CLAUDE.md, your .env) stays local and never propagates back.
