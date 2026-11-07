# shellcheck shell=bash
# bridgie ack <slug> [--decline] — answer the pending risk-path acknowledgement.

cmd_ack() {
  local slug="${1:-}"; shift || true
  [[ -n "$slug" ]] || die "usage: bridgie ack <slug> [--decline]"
  local ans="ack"
  [[ "${1:-}" == "--decline" ]] && ans="decline"
  local root; root="$(project_root)"
  local id; id="$(node_run flow.mjs pending-of-type "$root" "$slug" ack_risk | head -1)"
  [[ -n "$id" ]] || die "ack: nothing waiting for acknowledgement on '$slug'"
  node_run flow.mjs decision-answer "$root" "$slug" "$id" "$ans" --by "$(bridgie_user)" >/dev/null || exit 1
  state_commit "$root" "ack $slug: $ans"
  log "$id → $ans"
}
