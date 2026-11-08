#!/usr/bin/env bash
# One-line install on a fresh machine (needs git and node 20+; on Windows run it in Git Bash):
#   bash <(curl -fsSL https://raw.githubusercontent.com/anoopvijayan-dev/bridge/main/bin/get.sh)
# Clones (or updates) bridgie into ~/bridgie and runs its installer.
set -euo pipefail
dest="${BRIDGIE_INSTALL_DIR:-$HOME/bridgie}"
repo="${BRIDGIE_REPO:-https://github.com/anoopvijayan-dev/bridge.git}"
command -v git >/dev/null || { echo "get.sh: git is required"; exit 1; }
command -v node >/dev/null || { echo "get.sh: node 20+ is required (https://nodejs.org)"; exit 1; }
if [[ -d "$dest/.git" ]]; then
  echo "updating $dest"; git -C "$dest" pull -q --ff-only
else
  echo "cloning into $dest"; git clone -q "$repo" "$dest"
fi
bash "$dest/bin/install.sh"
