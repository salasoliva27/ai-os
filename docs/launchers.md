# Launching Janus IA

Janus is still one dashboard. The launchers only start the existing `./dash`
entry point with `JANUS_OPEN_BROWSER=1`, so model engines, MCP tools, and
credentials keep flowing through the same runtime.

## Desktop

From the computer where you want the Desktop icon, clone or download this repo
and run the installer for that operating system:

- Windows: double-click `Janus IA.cmd` to launch from the repo, or
  `install-desktop.cmd` to create a Desktop shortcut
- macOS: double-click `install-desktop.command`
- Linux: run `./scripts/install-launcher.sh`

That creates one of these, depending on the machine:

- Windows: `Janus IA.cmd` on the Desktop
- macOS: `Janus IA.command` on the Desktop
- Linux: `janus-ia.desktop` on the Desktop

Double-clicking it starts the bridge, builds the frontend when needed, loads
credentials from local `.env` files, and opens `http://localhost:3100`.

Credential load order:

1. `<workspace>/.env` — created by the dashboard for forks/shared installs.
2. `~/.env` — private dotfiles mirror; loaded last, so it wins if both exist.

If neither file exists, Janus still launches and the first-run setup asks that
machine's user to sign in or paste their own provider keys. Secrets are not
stored in git-tracked files.

On every launch, Janus checks Git for a safe fast-forward update before it
starts. If the repo has local tracked edits, it skips the update and continues
with the current checkout.

The installer must run on the target machine. Running it in Codespaces only
creates a launcher inside Codespaces, not on your laptop.

For first-time laptop setup with the private dotfiles repo, follow
`docs/laptop-setup.md` before using the launcher.

## Sharing

For an always-updated install, share the Git repo URL and have the other person
clone it. A raw zip is only a snapshot unless it includes `.git`, and it still
cannot pull or push unless that machine has GitHub access to the repo.

Do not include `.env`, `~/.codex`, `~/.claude`, browser profiles, or your
private dotfiles repo in any shared package. The launcher installs runtime
dependencies such as Node, npm packages, and provider CLIs on the receiving
machine; it does not carry your API keys or OAuth sessions.

## Samsung Phone

No app store package is needed. Janus is PWA-ready through
`manifest.webmanifest`, icons, and the service worker.

For a Samsung phone, open the dashboard URL in Chrome or Samsung Internet, then
use the browser menu's install/add-to-home-screen action. The phone must reach
the dashboard over a secure URL for full PWA install behavior. Use the Oracle
deployment, a Codespaces forwarded HTTPS URL, Tailscale Serve, or another HTTPS
reverse proxy rather than plain `http://localhost:3100`.

If you are only on the same Wi-Fi with a LAN IP, the browser may still create a
home-screen bookmark, but it may not install as a standalone app unless the URL
is HTTPS.
