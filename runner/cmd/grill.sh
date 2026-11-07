# shellcheck shell=bash
# bridgie grill <slug> — stress-test the bet's why; questions become decisions.
# shellcheck source=../lib/seat.sh
source "$BRIDGIE_HOME/runner/lib/seat.sh"

cmd_grill() {
  local slug="${1:-}"; [[ -n "$slug" ]] || die "usage: bridgie grill <slug>"
  local root; root="$(project_root)"
  local bet="$root/.bridgie/bets/$slug/bet.md"
  [[ -f "$bet" ]] || die "no bet '$slug' (bridgie bet new $slug)"
  local status; status="$(node_run state.mjs fm-get "$bet" status | tr -d '"')"
  case "$status" in
    draft|evidence) ;;
    *) die "grill: bet '$slug' is '$status'; only draft or evidence bets can be grilled" ;;
  esac
  node_run state.mjs bet-transition "$root" "$slug" grilling >/dev/null

  local run_dir
  if ! run_dir="$(run_seat "$slug" decide/grill)"; then
    node_run state.mjs bet-transition "$root" "$slug" "$status" >/dev/null || true
    die "grill: seat run failed; bet '$slug' returned to '$status'"
  fi
  local ids; ids="$(node_run state.mjs ingest-questions "$root" "$slug" "$run_dir/seat-output.json" --run "$(basename "$run_dir")")"
  node_run state.mjs ensure-sign "$root" "$slug" >/dev/null
  node_run state.mjs bet-transition "$root" "$slug" evidence >/dev/null
  state_commit "$root" "grill $slug ($(basename "$run_dir"))"
  local count; count="$(printf '%s' "$ids" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s||"[]").length)))')"
  log "grill $slug: $count question(s) raised, sign decision ready. Answer them with: bridgie open $slug   (or: bridgie decide $slug <id> <answer>)"
}
