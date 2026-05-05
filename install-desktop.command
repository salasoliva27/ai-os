#!/usr/bin/env bash
# Double-click installer for macOS, or run from a terminal on macOS/Linux.
# It creates a Desktop launcher that starts the Janus IA dashboard from this
# local repo clone.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

"$ROOT/scripts/install-launcher.sh"

if [ -t 0 ]; then
  printf "\nPress Return to close..."
  read -r _
fi
