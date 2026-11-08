#!/bin/sh
# One-line install on macOS, Linux or Git Bash (needs git and node 20+):
#   curl -fsSL https://raw.githubusercontent.com/anoopvijayan-dev/bridge/main/bin/get.sh | sh
# On Windows PowerShell:
#   git clone https://github.com/anoopvijayan-dev/bridge.git $HOME\bridgie; node $HOME\bridgie\bin\bridgie.mjs setup
set -e
dest="${BRIDGIE_INSTALL_DIR:-$HOME/bridgie}"
repo="${BRIDGIE_REPO:-https://github.com/anoopvijayan-dev/bridge.git}"
command -v git >/dev/null || { echo "get.sh: git is required"; exit 1; }
command -v node >/dev/null || { echo "get.sh: node 20+ is required (https://nodejs.org)"; exit 1; }
if [ -d "$dest/.git" ]; then echo "updating $dest"; git -C "$dest" pull -q --ff-only; else echo "cloning into $dest"; git clone -q "$repo" "$dest"; fi
exec node "$dest/bin/bridgie.mjs" setup
