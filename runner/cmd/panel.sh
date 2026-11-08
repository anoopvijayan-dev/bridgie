# shellcheck shell=bash
# bridgie panel <slug> [--n N | --quick] [--seed S]
# 1st run: the profiler drafts customer.yaml and pitch.md beside the bet, then stops for the owner.
# 2nd run: the runner deals N persona cards, one fresh buyer agent plays each, the runner tallies.
# shellcheck source=../lib/seat.sh
source "$BRIDGIE_HOME/runner/lib/seat.sh"
# shellcheck source=./research.sh
source "$BRIDGIE_HOME/runner/cmd/research.sh"

cmd_panel() {
  local slug="${1:-}"; shift || true
  [[ -n "$slug" ]] || die "usage: bridgie panel <slug> [--n N | --quick] [--seed S]"
  local n="" seed=1
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --n) n="$2"; shift 2 ;;
      --quick) n=20; shift ;;
      --seed) seed="$2"; shift 2 ;;
      *) die "panel: unknown argument $1" ;;
    esac
  done
  local root; root="$(project_root)"
  local bdir="$root/.bridgie/bets/$slug"
  [[ -f "$bdir/bet.md" ]] || die "no bet '$slug'"
  decide_status_ok "$root" "$slug" panel
  local policy; policy="$(node_run state.mjs policy "$root")"
  local def max; def="$(node -e 'console.log(JSON.parse(process.argv[1]).swarm?.default_n||20)' "$policy")"; max="$(node -e 'console.log(JSON.parse(process.argv[1]).swarm?.max_n||100)' "$policy")"
  [[ -n "$n" ]] || n="$def"
  [[ "$n" =~ ^[0-9]+$ && "$n" -ge 1 ]] || die "panel: --n must be a positive integer"
  [[ "$n" -le "$max" ]] || die "panel: $n buyers is above the policy ceiling swarm.max_n=$max"

  if [[ ! -f "$bdir/customer.yaml" || ! -f "$bdir/pitch.md" ]]; then
    local run_dir; run_dir="$(run_seat "$slug" decide/profiler)" || exit 1
    node -e '
      const fs=require("fs"); const o=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const f=o.files||{};
      if(!f["customer.yaml"]||!f["pitch.md"]) { console.error("profiler output has no files[customer.yaml] / files[pitch.md]"); process.exit(1); }
      fs.writeFileSync(process.argv[2]+"/customer.yaml", f["customer.yaml"]); fs.writeFileSync(process.argv[2]+"/pitch.md", f["pitch.md"]);' "$run_dir/seat-output.json" "$bdir" || die "panel: profiler output rejected (see $run_dir)"
    node_run panel.mjs deal "$bdir/customer.yaml" "$run_dir/deal-check.json" --n 1 >/dev/null || die "panel: the drafted customer.yaml does not validate; fix it by hand (see $run_dir)"
    state_commit "$root" "panel $slug: profile drafted"
    wait_human "panel: drafted .bridgie/bets/$slug/customer.yaml and pitch.md. Review and correct them (a wrong customer makes the whole panel wrong), then run bridgie panel $slug again"
  fi

  local pdir; pdir="$(next_panel_dir "$root" "$slug")"; mkdir -p "$pdir"
  node_run panel.mjs deal "$bdir/customer.yaml" "$pdir/cards.json" --n "$n" --seed "$seed" >/dev/null || die "panel: customer.yaml does not validate"
  log "panel: $n buyers dealt (seed $seed); running one buyer agent per card"
  local counts; counts="$(run_swarm "$slug" decide/buyer "$pdir/cards.json" "$pdir/buyers")"
  log "panel: ${counts% *} buyer run(s) finished, ${counts#* } failed twice and are excluded"
  local res; res="$(node_run panel.mjs write "$root" "$slug" "$pdir/cards.json" "$pdir/buyers")" || die "panel: nothing to tally (see $pdir)"
  state_commit "$root" "panel $slug ($(basename "$pdir"))"
  log "panel: buy rate $(json_get "$res" buy_rate) over $(json_get "$res" answered) answers ($(json_get "$res" excluded) excluded). Simulated buyers: an upper bound, not evidence. Read it: bridgie open $slug"
}

next_panel_dir() {   # next_panel_dir <root> <slug>
  local runs="$1/.bridgie/runs/$2" n
  mkdir -p "$runs"
  n="$(find "$runs" -maxdepth 1 -type d -name "panel-*" | wc -l | tr -d ' ')"
  printf '%s/panel-%02d\n' "$runs" "$((n + 1))"
}
