# shellcheck shell=bash
# run_seat <slug> <loop/seat> [--task T] [--cwd DIR] [--packet DIR] [--vars FILE] [--exclude DIR] [--no-lock]
#   → prints the run directory.
# --packet copies a directory (files and subdirectories) into the run directory before the context
#   is assembled; --vars copies one JSON file to run_dir/vars.json (the "card" input).
# --exclude DIR and --no-lock are for swarms: the parent holds the seat lock and all sibling runs
#   live under DIR, which the state guard then ignores.
# --cwd is where the seat works (a task or review worktree); state always lives in the project root.
# The only place an adapter is launched. Guards: fresh context from declared inputs, a project-wide
# seat lock, a full state manifest before/after (P1), output schema validation, cost entry.

# Single-writer guard (P1): runner/guard.mjs snapshots every file under .bridgie/ except worktrees,
# rendered pages, the lock and this run's own directory, then reports added/removed/changed files.
guard() {                     # guard <snapshot|check|restore> <root> <snapdir> <run_dir> [extra exclude]
  local extra=()
  [[ -n "${5:-}" ]] && extra=(--exclude "${5#"$2"/}")
  node_run guard.mjs "$1" "$2" "$3" --exclude "${4#"$2"/}" "${extra[@]}"
}

# Seat lock: one agent run per project at a time; state writers refuse while it is held.
seat_lock() {                 # seat_lock <root> <seat> <run_dir>
  local lock="$1/.bridgie/.seat-lock"
  if ! mkdir "$lock" 2>/dev/null; then
    local held; held="$(node_run state.mjs seat-lock "$1")"
    [[ -z "$held" ]] || die "another agent run is in progress in this project ($held); wait for it, or delete $lock if none is running"
    rm -rf "$lock"; mkdir "$lock" || die "could not take the seat lock $lock"
  fi
  printf '{"seat":"%s","run_dir":"%s","since":"%s","pid":%s}\n' "$2" "${3#"$1"/}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$$" > "$lock/owner.json"
}
seat_unlock() { rm -rf "$1/.bridgie/.seat-lock"; }

# adapter_capabilities <adapter> <seat dir> [model] → {"vendor","reads_repo"} JSON
adapter_capabilities() {
  "$BRIDGIE_HOME/adapters/$1/run.sh" --capabilities --seat "$2" --model "${3:-default}"
}

run_seat() {
  local slug="$1" seat="$2"; shift 2
  local task="" cwd="" packet="" vars="" exclude="" lock=1
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --task) task="$2"; shift 2 ;;
      --cwd) cwd="$2"; shift 2 ;;
      --packet) packet="$2"; shift 2 ;;
      --vars) vars="$2"; shift 2 ;;
      --exclude) exclude="$2"; shift 2 ;;
      --no-lock) lock=0; shift ;;
      *) die "run_seat: unknown argument $1" ;;
    esac
  done
  local root; root="$(project_root)"
  [[ -n "$cwd" ]] || cwd="$root"
  local seat_dir="$BRIDGIE_HOME/seats/$seat"
  [[ -f "$seat_dir/SKILL.md" ]] || die "no such seat: $seat"
  local name="${seat##*/}"
  local runs="${BRIDGIE_RUNS_DIR:-$root/.bridgie/runs/$slug}"; mkdir -p "$runs"
  local n; n="$(find "$runs" -maxdepth 1 -type d -name "$name-*" | wc -l | tr -d ' ')"; n=$((n + 1))
  local run_id; run_id="$(printf '%s-%02d' "$name" "$n")"
  local run_dir="$runs/$run_id"; mkdir -p "$run_dir"
  if [[ -n "$packet" ]]; then cp -R "$packet"/. "$run_dir"/ 2>/dev/null || true; fi
  if [[ -n "$vars" ]]; then cp "$vars" "$run_dir/vars.json"; fi

  # 1. fresh context from declared inputs only
  if [[ -n "$task" ]]; then
    node_run context.mjs assemble --root "$root" --slug "$slug" --seat "$seat" --run-dir "$run_dir" --cwd "$cwd" --task "$task" > "$run_dir/context.json" || die "context assembly failed for $seat"
  else
    node_run context.mjs assemble --root "$root" --slug "$slug" --seat "$seat" --run-dir "$run_dir" --cwd "$cwd" > "$run_dir/context.json" || die "context assembly failed for $seat"
  fi

  # 2. routing and adapter
  local route adapter model effort
  route="$(node_run state.mjs route "$root" "$seat")" || die "routing failed"
  adapter="$(json_get "$route" adapter)"; model="$(json_get "$route" model)"; effort="$(json_get "$route" effort)"
  [[ "$adapter" != "none" ]] || die "seat $seat has no model adapter (mechanical seats run in M1's verify command)"
  local adapter_sh="$BRIDGIE_HOME/adapters/$adapter/run.sh"
  [[ -x "$adapter_sh" ]] || die "adapter not found or not executable: $adapter_sh"
  local writes output mode="readonly"
  writes="$(node_run context.mjs manifest "$seat" writes)"; output="$(node_run context.mjs manifest "$seat" output)"
  [[ "$writes" == "worktree" ]] && mode="write"
  adapter_capabilities "$adapter" "$seat_dir" "$model" > "$run_dir/adapter.json" || die "adapter $adapter: --capabilities failed"
  if [[ "$(node_run context.mjs manifest "$seat" tools)" == *'"web"'* && "$(json_get "$(cat "$run_dir/adapter.json")" reads_web)" != "true" ]]; then
    die "seat $name needs web access; adapter '$adapter' has none (route it to one that does: routing.seats.$name)"
  fi

  # 3. lock, snapshot, launch, measure
  if [[ "$lock" == "1" ]]; then
    seat_lock "$root" "$name" "$run_dir"
    # shellcheck disable=SC2064   # expand now: the trap must release this root's lock
    trap "seat_unlock '$root'" EXIT
  fi
  guard snapshot "$root" "$run_dir/.snapshot" "$run_dir" "$exclude"
  local started_at start rc=0
  started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"; start="$(date +%s)"
  set +e
  if [[ -n "$effort" ]]; then
    "$adapter_sh" --seat "$seat_dir" --prompt "$run_dir/prompt.md" --out "$run_dir/$output" --cwd "$cwd" --mode "$mode" --model "$model" --effort "$effort" > "$run_dir/adapter.log" 2>&1
  else
    "$adapter_sh" --seat "$seat_dir" --prompt "$run_dir/prompt.md" --out "$run_dir/$output" --cwd "$cwd" --mode "$mode" --model "$model" > "$run_dir/adapter.log" 2>&1
  fi
  rc=$?
  set -e
  node_run state.mjs cost-add "$run_dir" --seat "$name" --adapter "$adapter" --model "$model" --started "$started_at" --duration "$(( $(date +%s) - start ))" --attempt "$n" --exit "$rc" >/dev/null

  # 4. single-writer guard (P1): any added, removed or changed state file fails the run
  local diff; diff="$(guard check "$root" "$run_dir/.snapshot" "$run_dir" "$exclude")"
  if [[ "$diff" != '{"added":[],"removed":[],"changed":[]}' ]]; then
    local restored; restored="$(guard restore "$root" "$run_dir/.snapshot" "$run_dir" "$exclude")"
    diff="$restored"
    [[ "$lock" == "1" ]] && { seat_unlock "$root"; trap - EXIT; }
    printf 'seat %s modified Bridgie state directly; state restored from snapshot\n%s\n' "$name" "$diff" > "$run_dir/VIOLATION"
    die "seat $name wrote to Bridgie state files; run failed and state restored (see $run_dir/VIOLATION)"
  fi
  [[ "$lock" == "1" ]] && { seat_unlock "$root"; trap - EXIT; }
  [[ $rc -eq 0 ]] || die "adapter $adapter exited $rc for seat $name; see $run_dir/adapter.log"

  # 5. output contract
  [[ -f "$run_dir/$output" ]] || die "seat $name produced no $output"
  node_run state.mjs validate "${output%.json}" "$run_dir/$output" || die "seat $name output does not match schemas/$output"
  printf '%s\n' "$run_dir"
}

# run_swarm <slug> <loop/seat> <cards.json> <swarm_dir>: one fresh seat run per card, `parallel` at a
# time, all under <swarm_dir>/<card id>/. Holds the seat lock for the whole swarm; each member runs
# with --no-lock and excludes the swarm directory from its state guard. A member that fails is retried
# once; after that it is left out (the tally counts it). Prints "<ok> <failed>".
run_swarm() {
  local slug="$1" seat="$2" cards="$3" dir="$4"
  local root; root="$(project_root)"
  local parallel; parallel="$(node_run state.mjs policy "$root" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).swarm?.parallel||4)))')"
  mkdir -p "$dir/cards"
  node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));for(const c of d.cards)require("fs").writeFileSync(`${process.argv[2]}/cards/${c.id}.json`,JSON.stringify(c,null,2))' "$cards" "$dir"
  seat_lock "$root" "${seat##*/}-swarm" "$dir"
  # shellcheck disable=SC2064
  trap "seat_unlock '$root'" EXIT
  local id running=0 ok=0 failed=0
  _member() {   # _member <id>: up to two attempts; the run dir is renamed to the card id
    local id="$1" out rc=1
    for _ in 1 2; do
      rm -rf "${dir:?}/${id:?}"
      if out="$(BRIDGIE_RUNS_DIR="$dir/.runs-$id" run_seat "$slug" "$seat" --vars "$dir/cards/$id.json" --exclude "$dir" --no-lock 2> "$dir/cards/$id.log")"; then
        mv "$out" "$dir/$id"; rm -rf "$dir/.runs-$id"; rc=0; break
      fi
      rm -rf "$dir/.runs-$id"
    done
    return $rc
  }
  for id in $(node -e 'for(const c of JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).cards)console.log(c.id)' "$cards"); do
    _member "$id" &
    running=$((running + 1))
    if [[ $running -ge $parallel ]]; then
      if wait -n; then ok=$((ok + 1)); else failed=$((failed + 1)); fi
      running=$((running - 1))
    fi
  done
  while [[ $running -gt 0 ]]; do
    if wait -n; then ok=$((ok + 1)); else failed=$((failed + 1)); fi
    running=$((running - 1))
  done
  seat_unlock "$root"; trap - EXIT
  printf '%s %s\n' "$ok" "$failed"
}
