# shellcheck shell=bash
# bridgie research <slug> — competitors, substitutes, prices and complaints from the web, every fact linked.
# shellcheck source=../lib/seat.sh
source "$BRIDGIE_HOME/runner/lib/seat.sh"

decide_status_ok() {   # decide_status_ok <root> <slug> <command>: draft, grilling or evidence only
  local status; status="$(node_run state.mjs fm-get "$1/.bridgie/bets/$2/bet.md" status | tr -d '"')"
  case "$status" in draft|grilling|evidence) ;; *) die "$3: bet '$2' is '$status'; the decide loop is closed" ;; esac
}

cmd_research() {
  local slug="${1:-}"; [[ -n "$slug" ]] || die "usage: bridgie research <slug>"
  local root; root="$(project_root)"
  [[ -f "$root/.bridgie/bets/$slug/bet.md" ]] || die "no bet '$slug'"
  decide_status_ok "$root" "$slug" research
  local run_dir; run_dir="$(run_seat "$slug" decide/researcher)" || exit 1
  local res; res="$(node_run decide.mjs write-research "$root" "$slug" "$run_dir/seat-output.json")" || die "research: output rejected (see $run_dir)"
  node_run state.mjs ingest-questions "$root" "$slug" "$run_dir/seat-output.json" --run "$(basename "$run_dir")" >/dev/null
  state_commit "$root" "research $slug ($(basename "$run_dir"))"
  log "research written to .bridgie/bets/$slug/research.md ($(json_get "$res" links) sources). Read it: bridgie open $slug"
}
