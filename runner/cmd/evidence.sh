# shellcheck shell=bash
# bridgie evidence <slug> — plan how each evidence task gets answered; with material in
# .bridgie/bets/<slug>/evidence/, synthesise it and raise a confidence proposal for the owner.
# shellcheck source=../lib/seat.sh
source "$BRIDGIE_HOME/runner/lib/seat.sh"
# shellcheck source=./research.sh
source "$BRIDGIE_HOME/runner/cmd/research.sh"

cmd_evidence() {
  local slug="${1:-}"; [[ -n "$slug" ]] || die "usage: bridgie evidence <slug>   (drop interview notes or exports in .bridgie/bets/$slug/evidence/ first to synthesise)"
  local root; root="$(project_root)"
  local bdir="$root/.bridgie/bets/$slug"
  [[ -f "$bdir/bet.md" ]] || die "no bet '$slug'"
  decide_status_ok "$root" "$slug" evidence
  local mode="plan"
  if [[ -d "$bdir/evidence" ]] && find "$bdir/evidence" -maxdepth 1 -type f ! -name '_*' | grep -q .; then mode="synthesis"; fi
  if [[ "$mode" == "plan" ]]; then
    local open; open="$(node_run decide.mjs open-evidence-tasks "$root" "$slug")"
    [[ "$open" != "[]" ]] || die "evidence: '$slug' has no open evidence tasks (answer a question with \"don't know\", or run bridgie panel) and no material in .bridgie/bets/$slug/evidence/"
  fi
  local run_dir; run_dir="$(run_seat "$slug" decide/evidence)" || exit 1
  local res; res="$(node_run decide.mjs write-evidence "$root" "$slug" "$run_dir/seat-output.json" "$mode")" || die "evidence: output rejected (see $run_dir)"
  node_run state.mjs ingest-questions "$root" "$slug" "$run_dir/seat-output.json" --run "$(basename "$run_dir")" >/dev/null
  local prop; prop="$(json_get "$res" proposal)"
  local did=""
  if [[ -n "$prop" ]]; then
    did="$(node_run flow.mjs propose-confidence "$root" "$slug" "$prop" --seat evidence --run "$(basename "$run_dir")")"
  fi
  state_commit "$root" "evidence $slug ($mode)"
  if [[ "$mode" == "plan" ]]; then
    log "evidence plan for $(json_get "$res" tasks) task(s) written to .bridgie/bets/$slug/evidence-plan.md. Run it in the real world, drop the notes in .bridgie/bets/$slug/evidence/, then bridgie evidence $slug again"
  elif [[ -n "$did" ]]; then
    log "synthesis written to .bridgie/bets/$slug/evidence-synthesis.md; confidence proposal raised as $did — accept or keep on bridgie open $slug"
  else
    log "synthesis written to .bridgie/bets/$slug/evidence-synthesis.md; no confidence change proposed"
  fi
}
