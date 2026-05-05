#!/usr/bin/env bash
# Install a desktop launcher for the Janus IA dashboard.
#
# The shortcut delegates to ./dash with JANUS_OPEN_BROWSER=1, so the same
# dotfiles-loaded credentials, MCP config, and workspace scoping are used.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="Janus IA"
ICON="$ROOT/dashboard/frontend/public/icons/icon.svg"

quote_sh() {
  printf "'%s'" "$(printf "%s" "$1" | sed "s/'/'\\\\''/g")"
}

desktop_dir() {
  for candidate in "$HOME/Desktop" "$HOME/Escritorio"; do
    if [ -d "$candidate" ]; then
      printf "%s" "$candidate"
      return 0
    fi
  done
  mkdir -p "$HOME/Desktop"
  printf "%s" "$HOME/Desktop"
}

install_windows() {
  local desktop root_w target
  desktop="$(desktop_dir)"
  root_w="$ROOT"
  if command -v cygpath >/dev/null 2>&1; then
    root_w="$(cygpath -w "$ROOT")"
  fi
  target="$desktop/$APP_NAME.cmd"

  cat > "$target" <<EOF
@echo off
setlocal
set "ROOT=$root_w"
call "%ROOT%\Janus IA.cmd"
EOF

  echo "Installed: $target"
}

install_macos() {
  local desktop wrapper target root_q
  desktop="$(desktop_dir)"
  wrapper="$HOME/.local/bin/janus-ia-launch"
  target="$desktop/$APP_NAME.command"
  root_q="$(quote_sh "$ROOT")"

  mkdir -p "$(dirname "$wrapper")"
  cat > "$wrapper" <<EOF
#!/usr/bin/env bash
set -e
cd $root_q
export JANUS_OPEN_BROWSER=1
exec $root_q/dash --open
EOF
  chmod +x "$wrapper"

  cat > "$target" <<EOF
#!/usr/bin/env bash
exec "$wrapper"
EOF
  chmod +x "$target"

  echo "Installed: $target"
}

install_linux() {
  local desktop wrapper shortcut root_q
  desktop="$(desktop_dir)"
  wrapper="$HOME/.local/bin/janus-ia-launch"
  shortcut="$desktop/janus-ia.desktop"
  root_q="$(quote_sh "$ROOT")"

  mkdir -p "$(dirname "$wrapper")"
  cat > "$wrapper" <<EOF
#!/usr/bin/env bash
set -e
cd $root_q
export JANUS_OPEN_BROWSER=1
exec $root_q/dash --open
EOF
  chmod +x "$wrapper"

  cat > "$shortcut" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=$APP_NAME
Comment=Launch the Janus IA dashboard
Exec=$wrapper
Icon=$ICON
Terminal=true
Categories=Development;Utility;
StartupNotify=true
EOF
  chmod +x "$shortcut"

  if command -v gio >/dev/null 2>&1; then
    gio set "$shortcut" metadata::trusted true >/dev/null 2>&1 || true
  fi

  echo "Installed: $shortcut"
  echo "Launcher command: $wrapper"
}

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) install_windows ;;
  Darwin) install_macos ;;
  *) install_linux ;;
esac

echo "Double-click the launcher to start Janus IA and open http://localhost:3100."
