#!/usr/bin/env bash
# Install bridgie for this user: skill for agent harnesses, PATH in every shell, Windows shim, routing policy.
#   bin/install.sh              everything below (idempotent; safe to re-run)
#   bin/install.sh --no-path    skip the PATH and shim changes
#   bin/install.sh --no-policy  skip creating ~/.bridgie/policy.yaml
# After it runs, open a NEW terminal (Git Bash, PowerShell or cmd on Windows) and type: bridgie
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
add_path=1 add_policy=1
for a in "$@"; do
  case "$a" in
    --path|--policy) ;;                       # old flags: now the default
    --no-path) add_path=0 ;;
    --no-policy) add_policy=0 ;;
    *) echo "install: unknown argument $a" >&2; exit 2 ;;
  esac
done

# 1. the agent skill
installed=0
for home in "$HOME/.claude" "$HOME/.agents"; do
  [[ -d "$home" ]] || continue
  mkdir -p "$home/skills/bridgie"
  cp "$HERE/skills/bridgie/SKILL.md" "$home/skills/bridgie/SKILL.md"
  echo "skill installed: $home/skills/bridgie/SKILL.md"
  installed=1
done
[[ "$installed" == "1" ]] || echo "no ~/.claude or ~/.agents folder found; copy skills/bridgie/ into your agent's skills folder by hand"

# 2. PATH in every shell profile bash might read, plus a Windows shim for PowerShell and cmd
line="export PATH=\"$HERE/bin:\$PATH\""
add_line() {   # add_line <file>: append the PATH line once
  if grep -qxF "$line" "$1" 2>/dev/null; then echo "PATH already set in $1"; else printf '\n# bridgie\n%s\n' "$line" >> "$1"; echo "added to $1: $line"; fi
}
if [[ "$add_path" == "1" ]]; then
  add_line "$HOME/.bashrc"
  # Git Bash and macOS login shells read ~/.bash_profile (or ~/.profile) and may never read ~/.bashrc
  if [[ -f "$HOME/.bash_profile" ]]; then add_line "$HOME/.bash_profile"; elif [[ -f "$HOME/.profile" ]]; then add_line "$HOME/.profile"; else add_line "$HOME/.bash_profile"; fi
  [[ -f "$HOME/.zshrc" || "${SHELL:-}" == *zsh ]] && add_line "$HOME/.zshrc"
  if [[ -n "${MSYSTEM:-}" || "$(uname -s)" == MINGW* || "$(uname -s)" == MSYS* ]]; then
    # Windows: %LOCALAPPDATA%\Microsoft\WindowsApps is already on every user's PATH; drop a shim there.
    shim_dir="$(cygpath -u "${LOCALAPPDATA:-$HOME/AppData/Local}")/Microsoft/WindowsApps"
    if [[ -d "$shim_dir" ]]; then
      bash_win="$(cygpath -w "$(command -v bash)")"
      printf '@echo off\r\n"%s" "%s" %%*\r\n' "$bash_win" "$(cygpath -w "$HERE/bin/bridgie")" > "$shim_dir/bridgie.cmd"
      echo "Windows shim installed: $shim_dir\\bridgie.cmd (bridgie now works from PowerShell and cmd too)"
    fi
  fi
else
  echo "PATH not changed (--no-path); add to your shell profile:  $line"
fi

# 3. routing policy for this machine
if [[ "$add_policy" == "1" ]]; then
  mkdir -p "$HOME/.bridgie"
  if [[ -f "$HOME/.bridgie/policy.yaml" ]]; then
    echo "$HOME/.bridgie/policy.yaml already exists; left unchanged"
  else
    cat > "$HOME/.bridgie/policy.yaml" <<'POLICY'
# Bridgie routing for this machine. Projects can override in .bridgie/policy.yaml.
# Adapters: claude-code, copilot, codex, antigravity, fake. Check them with: bridgie doctor
version: 1
routing:
  tiers:
    judgment: { adapter: copilot, model: claude-opus-5.5, effort: xhigh }
    production: { adapter: antigravity, model: default }
    scout: { adapter: antigravity, model: default }
  seats:
    reviewer: { adapter: copilot, model: claude-opus-5.5, effort: high }
POLICY
    echo "created $HOME/.bridgie/policy.yaml (judgment and review on Copilot Claude, production on Antigravity; edit to taste)"
  fi
fi

echo
echo "Done. Open a NEW terminal and type:  bridgie        (then: bridgie new my-idea)"
