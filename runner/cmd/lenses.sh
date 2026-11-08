# shellcheck shell=bash
# bridgie lenses <slug> — three board members (offer, moat, product lenses) and a chair.
# Also reached by: bridgie grill <slug> --lenses
# shellcheck source=../lib/seat.sh
source "$BRIDGIE_HOME/runner/lib/seat.sh"
# shellcheck source=./research.sh
source "$BRIDGIE_HOME/runner/cmd/research.sh"

cmd_lenses() {
  local slug="${1:-}"; [[ -n "$slug" ]] || die "usage: bridgie lenses <slug>"
  local root; root="$(project_root)"
  [[ -f "$root/.bridgie/bets/$slug/bet.md" ]] || die "no bet '$slug'"
  decide_status_ok "$root" "$slug" lenses
  local packet; packet="$(mktemp -d)"; mkdir -p "$packet/memos"
  local lens run_dir
  for lens in offer moat product; do
    log "board member: $lens lens"
    run_dir="$(run_seat "$slug" "decide/lens-$lens")" || exit 1
    node_run decide.mjs write-memo "$packet" "$lens" "$run_dir/seat-output.json" >/dev/null || die "lenses: the $lens memo was rejected (see $run_dir)"
  done
  log "chair"
  run_dir="$(run_seat "$slug" decide/chair --packet "$packet")" || exit 1
  local board; board="$(node_run decide.mjs write-board "$root" "$slug" "$run_dir" "$run_dir/seat-output.json")" || die "lenses: chair output rejected (see $run_dir)"
  rm -rf "$packet"
  local ids; ids="$(node_run state.mjs ingest-questions "$root" "$slug" "$run_dir/seat-output.json" --run "$(basename "$run_dir")")"
  state_commit "$root" "lenses $slug"
  local count; count="$(node -e 'console.log(JSON.parse(process.argv[1]||"[]").length)' "$ids")"
  log "board: $(json_get "$board" vote) (average $(json_get "$board" average_score)/10); $count question(s) raised. Read it: bridgie open $slug"
}
