# shellcheck shell=bash
# bridgie sign <slug> [--kill | --more-evidence]
# Shorthand: ensures a pending "sign" decision exists and answers it.

cmd_sign() {
  local slug="${1:-}"; shift || true
  [[ -n "$slug" ]] || die "usage: bridgie sign <slug> [--kill | --more-evidence]"
  local answer="sign"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --kill) answer="kill"; shift ;;
      --more-evidence) answer="need more evidence"; shift ;;
      *) die "sign: unknown argument $1" ;;
    esac
  done
  local root; root="$(project_root)"
  local status; status="$(node_run state.mjs fm-get "$root/.bridgie/bets/$slug/bet.md" status | tr -d '"')"
  [[ "$status" == "evidence" ]] || die "sign: bet '$slug' is '$status'; it must be in 'evidence' (run 'bridgie grill $slug' first)"
  local id; id="$(node_run state.mjs ensure-sign "$root" "$slug")" || exit 1
  node_run state.mjs decision-answer "$root" "$slug" "$id" "$answer" --by "$(bridgie_user)" >/dev/null || exit 1
  state_commit "$root" "sign $slug: $answer"
  log "bet $slug: $answer ($id)"
}
