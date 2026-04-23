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
./scripts/setup.sh    # installs dashboard + frontend deps
cd dashboard && npm run dev
```

Open http://localhost:3100. The chat will greet you and ask what you want
this workspace to be.

You'll need an Anthropic API key. Either:

- Open the **Credentials** panel (top-right), paste the key, save — or
- Set `ANTHROPIC_API_KEY` in your shell before starting the bridge.

## What's in the box

```
.
├── CLAUDE.md            # Instructions for the AI itself (read first)
├── README.md            # This file
├── dashboard/
│   ├── bridge/          # Single-file Express + WS server (bridge/server.ts)
│   └── frontend/        # React + Vite, ~3 components
├── scripts/setup.sh     # One-shot dependency install
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

## License

MIT
