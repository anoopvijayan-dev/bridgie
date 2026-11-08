# shellcheck shell=bash
# bridgie frame <slug> ["<one-line idea>"] — the framer drafts the bet body; assumptions become questions.
# shellcheck source=../lib/seat.sh
source "$BRIDGIE_HOME/runner/lib/seat.sh"

cmd_frame() {
  local slug="${1:-}" idea="${2:-}"
  [[ -n "$slug" ]] || die "usage: bridgie frame <slug> [\"<one-line idea>\"]"
  local root; root="$(project_root)"
  local bet="$root/.bridgie/bets/$slug/bet.md"
  [[ -f "$bet" ]] || die "no bet '$slug' (bridgie bet new $slug)"
  local status; status="$(node_run state.mjs fm-get "$bet" status | tr -d '"')"
  [[ "$status" == "draft" ]] || die "frame: bet '$slug' is '$status'; only a draft bet can be framed"
  [[ -n "$idea" ]] && { node_run decide.mjs add-idea "$root" "$slug" "$idea" >/dev/null || exit 1; }
  local run_dir; run_dir="$(run_seat "$slug" decide/framer)" || exit 1
  local replaced; replaced="$(node_run decide.mjs apply-frame "$root" "$slug" "$run_dir/seat-output.json")" || die "frame: framer output rejected (see $run_dir)"
  local ids; ids="$(node_run state.mjs ingest-questions "$root" "$slug" "$run_dir/seat-output.json" --run "$(basename "$run_dir")")"
  state_commit "$root" "frame $slug ($(basename "$run_dir"))"
  local count; count="$(node -e 'console.log(JSON.parse(process.argv[1]||"[]").length)' "$ids")"
  log "framed $slug: wrote $replaced; $count assumption(s) raised as questions. Review: bridgie open $slug   then: bridgie grill $slug"
}
