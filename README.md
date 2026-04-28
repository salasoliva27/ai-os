# ai-os

A blank-slate AI workspace template you can clone and shape via conversation.

- **Chat is the only thing on screen at first.** No pre-installed agents, no
  pre-loaded memories, no boilerplate to delete.
- **The AI does its own onboarding.** It asks what kind of AI you want, then
  enables exactly the panels you need.
- **Add tools by talking.** When you ask for a capability, the AI walks you
  through getting the credential and writes it to a gitignored `.env`.

## Quick start

```bash
git clone https://github.com/salasoliva27/ai-os.git my-ai
cd my-ai
./dash --open
```

Open http://localhost:3100. First run asks you to name the AI and connect an
engine. After that, the chat greets you and asks what you want this workspace
to be.

You'll need either an Anthropic or OpenAI API key. Either:

- Paste it in the first-run setup screen, or
- Open the **Credentials** panel later and add more keys.

Credentials are written to this clone's gitignored `.env`. They are not stored
in the template repo.

## What's in the box

```
.
├── CLAUDE.md            # Instructions for the AI itself (read first)
├── README.md            # This file
├── dashboard/
│   ├── bridge/          # Single-file Express + WS server (bridge/server.ts)
│   └── frontend/        # React + Vite, ~3 components
├── dash                 # One-shot launcher: update, install, build, run
├── AI OS.cmd            # Windows double-click launcher
├── install-desktop.cmd  # Windows Desktop shortcut installer with icon
├── assets/              # Desktop shortcut icon assets
├── scripts/setup.sh     # Dependency install helper
└── .devcontainer/       # GitHub Codespaces config
```

That's the whole template. ~600 lines of code, by design.

## How it grows

You start with chat. As you tell the AI what you want, panels appear in the
topbar (Credentials, Files, Tasks, Memory, Calendar, Research, etc.). Panels
listed in your profile but not yet implemented show a placeholder — ask the AI
to scaffold them and it will.

The dashboard's behavior is driven by `.dashboard/profile.json`, which the AI
writes via a special `<<PROFILE: {...}>>` block the bridge intercepts during
the first conversation.

## Template updates

Each clone can become its own AI without changing `salasoliva27/ai-os`.
Personal state lives in gitignored files (`.env`, `.dashboard/profile.json`) or
in commits on that person's own repository.

On every `./dash` launch, ai-os fetches template updates and applies them with
Git:

- If the clone has no local source commits, it fast-forwards.
- If the clone has local commits, it attempts a normal merge.
- If tracked files are dirty or a merge would conflict, it skips the update and
  keeps the current checkout untouched.

For a fully separate AI repo, keep `template` or `upstream` pointed at
`https://github.com/salasoliva27/ai-os.git` and set `origin` to the user's own
repo.

On Windows, run `install-desktop.cmd` once after cloning. It creates an `AI OS`
Desktop shortcut with its own icon; that shortcut still calls this clone's
`AI OS.cmd`, so every launch checks the template before starting.

## License

MIT
