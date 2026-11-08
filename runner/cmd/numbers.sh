# shellcheck shell=bash
# bridgie numbers <slug> [--template] — unit economics computed from .bridgie/bets/<slug>/numbers.yaml.
# shellcheck source=../lib/common.sh
source "$BRIDGIE_HOME/runner/lib/common.sh"

cmd_numbers() {
  local slug="${1:-}"; shift || true
  [[ -n "$slug" ]] || die "usage: bridgie numbers <slug> [--template]"
  local template=0
  while [[ $# -gt 0 ]]; do case "$1" in --template) template=1; shift ;; *) die "numbers: unknown argument $1" ;; esac; done
  local root; root="$(project_root)"
  local bdir="$root/.bridgie/bets/$slug"
  [[ -f "$bdir/bet.md" ]] || die "no bet '$slug'"
  if [[ "$template" == "1" ]]; then
    [[ -f "$bdir/numbers.yaml" ]] && die "numbers: $bdir/numbers.yaml already exists; edit it, then run bridgie numbers $slug"
    node_run numbers.mjs template > "$bdir/numbers.yaml"
    log "wrote .bridgie/bets/$slug/numbers.yaml with example figures. Replace them with yours, then: bridgie numbers $slug"
    return
  fi
  local res; res="$(node_run numbers.mjs write "$root" "$slug")" || exit 1
  state_commit "$root" "numbers $slug"
  local v; v="$(json_get "$res" verdict)"
  if [[ "$v" == "profitable" ]]; then
    log "numbers: profitable on these inputs — contribution $(json_get "$res" contribution)/unit, break-even $(json_get "$res" break_even)/day, margin $(json_get "$res" margin), payback month $(json_get "$res" payback). See .bridgie/bets/$slug/numbers.md"
  else
    log "numbers: not yet — failing $(json_get "$res" failing). See .bridgie/bets/$slug/numbers.md"
  fi
}
