# shellcheck shell=bash
# bridgie verify <slug> [--task T]
# Verifies ONE task in status "verify": diff packet (R8), risk-path ack (R9), mechanical tiers,
# a read-only reviewer in a detached worktree (R3, R10, R11), reconcile (R4, R5), merge on pass.
# shellcheck source=../lib/seat.sh
source "$BRIDGIE_HOME/runner/lib/seat.sh"
# shellcheck source=../lib/git.sh
source "$BRIDGIE_HOME/runner/lib/git.sh"

next_run_dir() {   # next_run_dir <root> <slug> <name>
  local runs="$1/.bridgie/runs/$2" n
  mkdir -p "$runs"
  n="$(find "$runs" -maxdepth 1 -type d -name "$3-*" | wc -l | tr -d ' ')"
  printf '%s/%s-%02d\n' "$runs" "$3" "$((n + 1))"
}

verify_checks_reviewer() {   # R10 and R11, before any model is called
  local root="$1" slug="$2" task="$3" route adapter caps reads vendor producer
  route="$(node_run state.mjs route "$root" verify/reviewer)"
  adapter="$(json_get "$route" adapter)"
  caps="$(adapter_capabilities "$adapter" "$BRIDGIE_HOME/seats/verify/reviewer" "$(json_get "$route" model)")" || die "verify: adapter $adapter: --capabilities failed"
  reads="$(json_get "$caps" reads_repo)"; vendor="$(json_get "$caps" vendor)"
  [[ "$reads" == "true" ]] || die "verify: reviewer adapter '$adapter' cannot read the repository; a packet-only review is refused (R10)"
  if [[ "$(node_run flow.mjs cross-family "$root" "$slug")" == "true" ]]; then
    producer="$(node_run flow.mjs producer-vendor "$root" "$slug" "$task")"
    [[ "$producer" != "$vendor" ]] || die "verify: reviewer vendor '$vendor' is the same as the producer's; policy requires a different model family (set routing.seats.reviewer)"
  fi
}

run_mechanical() {   # run_mechanical <root> <slug> <wt> <vdir> → writes vdir/mechanical.json
  # A required tier with no configured command becomes a not_proven row (never silently skipped).
  local root="$1" slug="$2" wt="$3" vdir="$4" plan n=0 tier cmd missing rc result rows="[]"
  plan="$(node_run flow.mjs mechanical-plan "$root" "$slug" "$wt")"
  while IFS=$'\t' read -r tier missing cmd; do
    [[ -n "$tier" ]] || continue
    n=$((n + 1))
    if [[ "$missing" == "1" ]]; then
      log "  $tier: no command configured (required at this risk) → not_proven"
      cmd="no command configured for required tier $tier (set verify.commands.$tier in .bridgie/policy.yaml)"; result="not_proven"
      : > "$vdir/$tier-$n.log"
    else
      log "  $tier: $cmd"
      set +e; (cd "$wt" && bash -c "$cmd") > "$vdir/$tier-$n.log" 2>&1; rc=$?; set -e
      result="fail"; [[ $rc -eq 0 ]] && result="pass"
    fi
    rows="$(node -e '
      const rows = JSON.parse(process.argv[1]);
      rows.push({ id: `${process.argv[2]}:${process.argv[3]}`, tier: process.argv[2], check: process.argv[4], result: process.argv[5], artifact: process.argv[6] });
      console.log(JSON.stringify(rows));' "$rows" "$tier" "$n" "$cmd" "$result" "$vdir/$tier-$n.log")"
  done < <(node -e 'for (const x of JSON.parse(process.argv[1])) console.log(`${x.tier}\t${x.missing ? 1 : 0}\t${x.cmd ?? ""}`)' "$plan")
  printf '%s\n' "$rows" > "$vdir/mechanical.json"
}

cmd_verify() {
  local slug="${1:-}"; shift || true
  [[ -n "$slug" ]] || die "usage: bridgie verify <slug> [--task T]"
  local task=""
  while [[ $# -gt 0 ]]; do case "$1" in --task) task="$2"; shift 2 ;; *) die "verify: unknown argument $1" ;; esac; done
  local root; root="$(project_root)"
  git_on_feature "$root" "$slug"
  if [[ -z "$task" ]]; then
    task="$(node -e 'const t=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).tasks.find(x=>x.status==="verify");console.log(t?t.id:"")' "$root/.bridgie/specs/$slug/tasks.json")"
    [[ -n "$task" ]] || die "verify: no task of '$slug' is waiting for verification (bridgie build $slug)"
  fi
  [[ "$(json_get "$(node_run flow.mjs task-get "$root" "$slug" "$task")" status)" == "verify" ]] || die "verify: task $task is not in status verify"
  local wt; wt="$(task_wt_path "$root" "$slug" "$task")"
  [[ -d "$wt" ]] || die "verify: worktree for $task is missing ($wt)"
  git_commit_all "$wt" "bridgie: $task manual changes before verify"

  # 1. packet (R8) and risk paths (R9)
  local vdir; vdir="$(next_run_dir "$root" "$slug" verify)"; mkdir -p "$vdir"
  git_diff_packet "$root" "$slug" "$task" "$vdir"
  local risk eff paths; risk="$(node_run flow.mjs risk-of-paths "$root" "$slug" "$vdir/files.txt")"
  eff="$(json_get "$risk" effective)"
  paths="$(node -e 'console.log(JSON.parse(process.argv[1]).paths.join(", ") || "no risk paths")' "$risk")"
  # Effective risk = max(bet, requirements, changed paths); a raise is persistent and logged.
  if [[ "$(json_get "$(node_run flow.mjs raise-risk "$root" "$slug" "$eff" --reason "task $task changes $paths")" changed)" == "true" ]]; then
    log "risk raised to $eff by the paths task $task changes"
  fi
  if [[ "$(json_get "$risk" needs_ack)" == "true" ]]; then
    [[ "$(node_run flow.mjs ack-declined "$root" "$slug")" == "true" ]] && die "verify: the risk acknowledgement for '$slug' was declined"
    if [[ "$(node_run flow.mjs ack-recorded "$root" "$slug")" != "true" ]]; then
      node_run flow.mjs ensure-decision "$root" "$slug" ack_risk \
        "Task $task is risk $eff (changes: $paths). Policy requires a human acknowledgement before verification." '["ack","decline"]' --risk "$eff" >/dev/null
      state_commit "$root" "ack requested for $slug ($task)"
      wait_human "verify: $task touches $eff paths; waiting for a human ack (bridgie ack $slug, or bridgie open $slug)"
    fi
  fi

  # 2. reviewer preconditions (R10, R11)
  verify_checks_reviewer "$root" "$slug" "$task"

  # 3. mechanical tiers in the task worktree
  run_mechanical "$root" "$slug" "$wt" "$vdir"

  # 4. reviewer in a detached, read-only worktree (R3)
  local rv rv_dir rc=0
  rv="$(git_review_worktree "$root" "$slug" "$task")"
  set +e; rv_dir="$(run_seat "$slug" verify/reviewer --task "$task" --cwd "$rv" --packet "$vdir")"; rc=$?; set -e
  local dirty; dirty="$(git -C "$rv" status --porcelain 2>/dev/null || true)"
  git_remove_worktree "$root" "$rv"
  [[ $rc -eq 0 ]] || die "verify: reviewer run failed for $task; task stays in verify"
  if [[ -n "$dirty" ]]; then
    printf 'reviewer changed files in its read-only worktree:\n%s\n' "$dirty" > "$rv_dir/VIOLATION"
    die "verify: the reviewer modified its read-only worktree; run failed (R3, see $rv_dir/VIOLATION)"
  fi
  node_run flow.mjs stamp-task "$rv_dir/evidence.json" "$task" >/dev/null

  # 5. reconcile (R4, R5) and merge on pass
  local verdict
  verdict="$(node_run flow.mjs reconcile "$root" "$slug" "$task" "$rv_dir/evidence.json" "$vdir/mechanical.json" "$vdir/evidence.json")" || die "verify: reconcile failed"
  if [[ "$verdict" == "pass" ]]; then
    git_merge_task "$root" "$slug" "$task"
    node_run flow.mjs mark-passed "$root" "$slug" "$task" "$vdir/evidence.json" >/dev/null
    state_commit "$root" "verify $slug $task: pass"
    log "verified $task: pass; merged into bridgie/$slug"
  else
    state_commit "$root" "verify $slug $task: $verdict"
    local t; t="$(node_run flow.mjs task-get "$root" "$slug" "$task")"
    log "verified $task: $verdict → $(json_get "$t" status). $(json_get "$t" escalation)"
    [[ "$(json_get "$t" status)" == "blocked" ]] && log "Decide what happens next: bridgie open $slug"
    return 2
  fi
}
