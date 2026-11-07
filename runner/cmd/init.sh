# shellcheck shell=bash
# bridgie init [--lane L] — create .bridgie/ in the current folder.

cmd_init() {
  local lane="engineering"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --lane) lane="$2"; shift 2 ;;
      *) die "init: unknown argument $1" ;;
    esac
  done
  local root="$PWD" st="$PWD/.bridgie"
  [[ -e "$st" ]] && die "init: $st already exists"
  need_cmd node
  mkdir -p "$st"/{bets,specs,runs,acceptance,decisions,learn}
  sed "s/{{lane}}/$lane/" "$BRIDGIE_HOME/templates/project-policy.yaml" > "$st/policy.yaml"
  cp "$BRIDGIE_HOME/templates/bridgie-gitignore" "$st/.gitignore"
  printf '# Gotchas\n\nDated one-line corrections learned in this project.\n' > "$st/learn/gotchas.md"
  node_run state.mjs policy "$root" >/dev/null || die "init: generated policy does not validate"
  state_commit "$root" "init (lane $lane)"
  log "initialised $st (lane: $lane). Next: bridgie bet new <slug>"
}
