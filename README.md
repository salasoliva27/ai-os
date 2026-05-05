# janus-ia

An engine-neutral AI operating system for running a venture portfolio: validates
ideas, builds products, coordinates legal/financial/calendar, and compounds
learnings across every build. Claude Code and Codex are processors behind the
same Janus brain.

This is Jano's working brain. The repo is public so you can fork it as a starting
point for your own setup.

---

## Using this as a template

The repo ships with the brain framework intact (`AGENTS.md`, Claude/Codex
adapter entry points, agents, concepts, scripts, dashboard, MCP servers,
tools/skills registries) and strips out the personal content (Jano's wikis,
projects, outputs).

1. **Fork** this repo on GitHub.
2. **Open it in a Codespace** (or clone locally with at least one supported
   engine CLI installed).
3. **Strip personal content**:
   ```bash
   ./scripts/init-fork.sh
   ```
   This removes `wiki/`, `projects/`, `outputs/`, `dump/` and resets
   `PROJECTS.md`, `learnings/market.md`, `learnings/supabase-registry.md` to
   empty templates. Re-runnable.
4. **Launch the dashboard**:
   ```bash
   ./dash
   ```
   To install a desktop shortcut that starts the same dashboard and opens the
   browser on your own computer, clone/download the repo there and run
   `Janus IA.cmd` on Windows to launch directly from the repo,
   `install-desktop.cmd` on Windows to create a Desktop shortcut,
   `install-desktop.command` on macOS, or `./scripts/install-launcher.sh` on
   Linux.
   First-time laptop setup with dotfiles is documented in
   [`docs/laptop-setup.md`](docs/laptop-setup.md).
5. **First turn, tell the AI**: `run discovery`. It will walk you through naming
   your projects, declaring your stack, and personalizing the agents.

Credentials are deliberately outside this repo. Private installs can mirror
`dotfiles/.env` into `~/.env`; shared or forked installs use the first-run UI to
save that user's own credentials into a local gitignored `.env`.

What you keep from the fork: the dispatch protocol, all 16 agents, the
inline-learning + vault-plasticity rules, the cross-synthesis checklist, the
MCP/skills/tools registries (with verdicts), and the dashboard.

What you start fresh: your projects, your wikis, your outputs, your memory.

---

## Using `./dash` from other repos (Jano's own setup)

The dashboard is workspace-aware. From any repo, you can launch the same UI
scoped to that repo by dropping a tiny wrapper in:

```bash
/workspaces/janus-ia/scripts/dash-link /workspaces/<other-repo>
```

Then in that repo:
```bash
./dash
```

It uses janus-ia's dashboard code but reads/writes its own workspace files
(`learnings/`, `concepts/`, `wiki/`, memory namespace, etc.). Memory is scoped
per workspace, so jp-ai's memory stays in jp-ai's namespace.

Desktop and Samsung home-screen launcher notes live in
[`docs/launchers.md`](docs/launchers.md).

---

## Layout

```
agents/         16 agent specs (developer, ux, legal, financial, ...)
concepts/       Cross-project patterns (the compounding layer)
learnings/      Domain knowledge (market, technical, gtm, patterns)
dashboard/      The UI you launch with ./dash
mcp-servers/    Local MCP servers (memory, etc.)
scripts/        Bootstrap, preflight, gdrive, dash-link, init-fork
tools/          Tool registry + configs
skills/         Skills registry
AGENTS.md       Canonical brain, agent registry, and tool contract
CLAUDE.md       Claude Code compatibility loader
```

`AGENTS.md` is the provider-neutral source of truth. `CLAUDE.md` exists only so
Claude Code can boot into the same brain.
