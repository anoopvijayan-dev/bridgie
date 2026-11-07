#!/usr/bin/env bash
# Install the bridgie skill for agent harnesses and show how to put bridgie on PATH.
#   bin/install.sh            copy skills/bridgie to ~/.claude/skills and ~/.agents/skills (when those homes exist)
#   bin/install.sh --path     also append the PATH line to ~/.bashrc
#   bin/install.sh --policy   also create ~/.bridgie/policy.yaml (routing per machine) if missing
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
add_path=0 add_policy=0
for a in "$@"; do
  case "$a" in
    --path) add_path=1 ;;
    --policy) add_policy=1 ;;
    *) echo "install: unknown argument $a" >&2; exit 2 ;;
  esac
done

installed=0
for home in "$HOME/.claude" "$HOME/.agents"; do
  [[ -d "$home" ]] || continue
  mkdir -p "$home/skills/bridgie"
  cp "$HERE/skills/bridgie/SKILL.md" "$home/skills/bridgie/SKILL.md"
  echo "skill installed: $home/skills/bridgie/SKILL.md"
  installed=1
done
[[ "$installed" == "1" ]] || echo "no ~/.claude or ~/.agents folder found; copy skills/bridgie/ into your agent's skills folder by hand"

line="export PATH=\"$HERE/bin:\$PATH\""
if [[ "$add_path" == "1" ]]; then
  if grep -qxF "$line" "$HOME/.bashrc" 2>/dev/null; then echo "PATH already set in ~/.bashrc"; else printf '\n# bridgie\n%s\n' "$line" >> "$HOME/.bashrc"; echo "added to ~/.bashrc: $line"; fi
else
  echo "to put bridgie on PATH, add to ~/.bashrc:  $line   (or re-run with --path)"
fi

if [[ "$add_policy" == "1" ]]; then
  mkdir -p "$HOME/.bridgie"
  if [[ -f "$HOME/.bridgie/policy.yaml" ]]; then
    echo "$HOME/.bridgie/policy.yaml already exists; left unchanged"
  else
    cat > "$HOME/.bridgie/policy.yaml" <<'EOF'
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
EOF
    echo "created $HOME/.bridgie/policy.yaml (judgment and review on Copilot Claude, production on Antigravity; edit to taste)"
  fi
fi
