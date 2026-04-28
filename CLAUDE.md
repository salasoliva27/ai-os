# ai-os

A blank-slate Claude Code workspace. The chat panel is the entry point.
Everything else is opt-in via conversation.

## How this template works

- The dashboard ships with **engine setup + chat + credentials** only.
- On first boot, the setup page asks the user to name the AI and connect either
  Anthropic or OpenAI credentials. The chat then asks what kind of AI they want.
- Based on the user's answer, the AI emits a `<<PROFILE: {...}>>` block that
  the bridge intercepts and writes to `.dashboard/profile.json`. That profile
  toggles which UI panels appear and tailors future system prompts.
- No memory, agents, projects, or processes are pre-installed. The user grows
  the workspace by asking for what they need.

## Onboarding contract (the AI follows this on first turn)

If `profile.firstBoot === true`, your first response should:

1. Greet the user using the AI name already stored in the profile and ask what
   kind of AI they want this to be. Keep it open — one short question, no
   menus. Examples to suggest only if asked: coding
   assistant, writing partner, research tool, business operator, learning tutor.
2. Recommend which panels to enable from this fixed list:
   `credentials` (always on), `files`, `tasks`, `memory`, `calendar`, `research`.
3. Once the user confirms, emit EXACTLY this line on its own:
  `<<PROFILE: {"aiKind":"<short-label>","enabledTools":["credentials","files",...],"systemPromptAdditions":"<one-line tailored instruction>","firstBoot":false}>>`
4. Follow with a one-line summary of what was enabled.

Do not invent panels not in the list. Do not emit the PROFILE line until the
user confirms.

## After onboarding

- The system prompt for every subsequent turn includes
  `profile.systemPromptAdditions`. Keep it short and behavioral.
- New panels are revealed by the topbar based on `profile.enabledTools`.
- Panels listed in the profile but not yet implemented show a placeholder. The
  user can ask the AI to scaffold them — files live at
  `dashboard/frontend/src/components/<Name>.tsx`.

## Permissions

Default: Full Auto. Files in this repo are fair game. External writes (git
push, GitHub API, Google APIs) require the user to set the relevant credentials
via the Credentials panel first.

## Running the dashboard

```bash
./dash --open
```

Then open http://localhost:3100.

## Template updates

`ai-os` is the upstream template. A clone becomes the user's own AI through
gitignored state (`.env`, `.dashboard/profile.json`) and any commits they make
on their own repository. The launcher fetches template updates on startup and
uses Git merge semantics so user changes are preserved; if tracked files are
dirty or a merge conflicts, it skips the update.

## Adding capabilities later

When the user asks for a new tool or panel:

1. If a credential is needed, walk the user through getting the key, then
   instruct them to paste it into the Credentials panel (which writes to
   `.env` and gitignores it).
2. If a new UI panel is needed, add a `<Name>.tsx` to
   `dashboard/frontend/src/components/`, wire it into `App.tsx`'s
   `openPanel === "<id>"` branch, and rebuild the frontend.
3. If MCP servers are needed, add them to `.mcp.json` at the repo root and
   restart Claude Code. Ask the user before installing anything.
