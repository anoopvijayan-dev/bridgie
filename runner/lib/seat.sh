# shellcheck shell=bash
# run_seat <slug> <loop/seat> [--task T] → prints the run directory.
# The only place an adapter is launched. Guards: fresh context from declared inputs,
# state snapshot before/after (P1), output schema validation, cost entry.

_state_files() {              # _state_files <root> <slug> → existing state files for the bet
  local root="$1" slug="$2" f
  for f in ".bridgie/bets/$slug/bet.md" ".bridgie/decisions/$slug.json" ".bridgie/specs/$slug/tasks.json" ".bridgie/acceptance/$slug.md"; do
    [[ -f "$root/$f" ]] && printf '%s\n' "$f"
  done
}

snapshot_state() {            # snapshot_state <root> <slug> <snapdir>
  local root="$1" slug="$2" snap="$3" f
  mkdir -p "$snap"
  while IFS= read -r f; do mkdir -p "$snap/$(dirname "$f")"; cp "$root/$f" "$snap/$f"; done < <(_state_files "$root" "$slug")
}

state_changed() {             # state_changed <root> <slug> <snapdir> → 0 if any state file differs or appeared
  local root="$1" slug="$2" snap="$3" f
  while IFS= read -r f; do
    [[ -f "$snap/$f" ]] || return 0
    cmp -s "$root/$f" "$snap/$f" || return 0
  done < <(_state_files "$root" "$slug")
  return 1
}

restore_state() {             # restore_state <root> <snapdir>
  local root="$1" snap="$2" f
  (cd "$snap" && find . -type f) | while IFS= read -r f; do cp "$snap/$f" "$root/$f"; done
}

run_seat() {
  local slug="$1" seat="$2"; shift 2
  local task=""
  while [[ $# -gt 0 ]]; do case "$1" in --task) task="$2"; shift 2 ;; *) die "run_seat: unknown argument $1" ;; esac; done
  local root; root="$(project_root)"
  local seat_dir="$BRIDGIE_HOME/seats/$seat"
  [[ -f "$seat_dir/SKILL.md" ]] || die "no such seat: $seat"
  local name="${seat##*/}"
  local runs="$root/.bridgie/runs/$slug"; mkdir -p "$runs"
  local n; n="$(find "$runs" -maxdepth 1 -type d -name "$name-*" | wc -l | tr -d ' ')"; n=$((n + 1))
  local run_id; run_id="$(printf '%s-%02d' "$name" "$n")"
  local run_dir="$runs/$run_id"; mkdir -p "$run_dir"

  # 1. fresh context from declared inputs only
  if [[ -n "$task" ]]; then
    node_run context.mjs assemble --root "$root" --slug "$slug" --seat "$seat" --run-dir "$run_dir" --cwd "$root" --task "$task" > "$run_dir/context.json" || die "context assembly failed for $seat"
  else
    node_run context.mjs assemble --root "$root" --slug "$slug" --seat "$seat" --run-dir "$run_dir" --cwd "$root" > "$run_dir/context.json" || die "context assembly failed for $seat"
  fi

  # 2. routing and adapter
  local route adapter model effort
  route="$(node_run state.mjs route "$root" "$seat")" || die "routing failed"
  adapter="$(json_get "$route" adapter)"; model="$(json_get "$route" model)"; effort="$(json_get "$route" effort)"
  [[ "$adapter" != "none" ]] || die "seat $seat has no model adapter (mechanical seats run in M1's verify command)"
  local adapter_sh="$BRIDGIE_HOME/adapters/$adapter/run.sh"
  [[ -x "$adapter_sh" ]] || die "adapter not found or not executable: $adapter_sh"
  local writes output mode=readonly
  writes="$(node_run context.mjs manifest "$seat" writes)"; output="$(node_run context.mjs manifest "$seat" output)"
  [[ "$writes" == "worktree" ]] && mode=write

  # 3. snapshot, launch, measure
  snapshot_state "$root" "$slug" "$run_dir/.snapshot"
  local started_at start rc=0
  started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"; start="$(date +%s)"
  set +e
  if [[ -n "$effort" ]]; then
    "$adapter_sh" --seat "$seat_dir" --prompt "$run_dir/prompt.md" --out "$run_dir/$output" --cwd "$root" --mode "$mode" --model "$model" --effort "$effort" > "$run_dir/adapter.log" 2>&1
  else
    "$adapter_sh" --seat "$seat_dir" --prompt "$run_dir/prompt.md" --out "$run_dir/$output" --cwd "$root" --mode "$mode" --model "$model" > "$run_dir/adapter.log" 2>&1
  fi
  rc=$?
  set -e
  node_run state.mjs cost-add "$run_dir" --seat "$name" --adapter "$adapter" --model "$model" --started "$started_at" --duration "$(( $(date +%s) - start ))" --attempt "$n" --exit "$rc" >/dev/null

  # 4. single-writer guard (P1)
  if state_changed "$root" "$slug" "$run_dir/.snapshot"; then
    restore_state "$root" "$run_dir/.snapshot"
    printf 'seat %s modified Bridgie state directly; state restored from snapshot\n' "$name" > "$run_dir/VIOLATION"
    die "seat $name wrote to Bridgie state files; run failed and state restored (see $run_dir/VIOLATION)"
  fi
  [[ $rc -eq 0 ]] || die "adapter $adapter exited $rc for seat $name; see $run_dir/adapter.log"

  # 5. output contract
  [[ -f "$run_dir/$output" ]] || die "seat $name produced no $output"
  node_run state.mjs validate "${output%.json}" "$run_dir/$output" || die "seat $name output does not match schemas/$output"
  printf '%s\n' "$run_dir"
}
