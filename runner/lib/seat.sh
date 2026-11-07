# shellcheck shell=bash
# run_seat <slug> <loop/seat> [--task T] [--cwd DIR] [--packet DIR] → prints the run directory.
# --packet copies diff.patch etc. into the run directory before the context is assembled.
# --cwd is where the seat works (a task or review worktree); state always lives in the project root.
# The only place an adapter is launched. Guards: fresh context from declared inputs, a project-wide
# seat lock, a full state manifest before/after (P1), output schema validation, cost entry.

# Single-writer guard (P1): runner/guard.mjs snapshots every file under .bridgie/ except worktrees,
# rendered pages, the lock and this run's own directory, then reports added/removed/changed files.
guard() {                     # guard <snapshot|check|restore> <root> <snapdir> <run_dir>
  node_run guard.mjs "$1" "$2" "$3" --exclude "${4#"$2"/}"
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
  local task="" cwd="" packet=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --task) task="$2"; shift 2 ;;
      --cwd) cwd="$2"; shift 2 ;;
      --packet) packet="$2"; shift 2 ;;
      *) die "run_seat: unknown argument $1" ;;
    esac
  done
  local root; root="$(project_root)"
  [[ -n "$cwd" ]] || cwd="$root"
  local seat_dir="$BRIDGIE_HOME/seats/$seat"
  [[ -f "$seat_dir/SKILL.md" ]] || die "no such seat: $seat"
  local name="${seat##*/}"
  local runs="$root/.bridgie/runs/$slug"; mkdir -p "$runs"
  local n; n="$(find "$runs" -maxdepth 1 -type d -name "$name-*" | wc -l | tr -d ' ')"; n=$((n + 1))
  local run_id; run_id="$(printf '%s-%02d' "$name" "$n")"
  local run_dir="$runs/$run_id"; mkdir -p "$run_dir"
  if [[ -n "$packet" ]]; then cp "$packet"/* "$run_dir"/ 2>/dev/null || true; fi

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

  # 3. lock, snapshot, launch, measure
  seat_lock "$root" "$name" "$run_dir"
  # shellcheck disable=SC2064   # expand now: the trap must release this root's lock
  trap "seat_unlock '$root'" EXIT
  guard snapshot "$root" "$run_dir/.snapshot" "$run_dir"
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
  local diff; diff="$(guard check "$root" "$run_dir/.snapshot" "$run_dir")"
  if [[ "$diff" != '{"added":[],"removed":[],"changed":[]}' ]]; then
    guard restore "$root" "$run_dir/.snapshot" "$run_dir" >/dev/null
    seat_unlock "$root"; trap - EXIT
    printf 'seat %s modified Bridgie state directly; state restored from snapshot\n%s\n' "$name" "$diff" > "$run_dir/VIOLATION"
    die "seat $name wrote to Bridgie state files; run failed and state restored (see $run_dir/VIOLATION)"
  fi
  seat_unlock "$root"; trap - EXIT
  [[ $rc -eq 0 ]] || die "adapter $adapter exited $rc for seat $name; see $run_dir/adapter.log"

  # 5. output contract
  [[ -f "$run_dir/$output" ]] || die "seat $name produced no $output"
  node_run state.mjs validate "${output%.json}" "$run_dir/$output" || die "seat $name output does not match schemas/$output"
  printf '%s\n' "$run_dir"
}
