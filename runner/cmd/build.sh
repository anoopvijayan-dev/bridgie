# shellcheck shell=bash
# bridgie build <slug> [--task T] [--harden]
# Builds ONE ready task: fresh worktree, implementer (and hardener), runner commits, status → verify.
# shellcheck source=../lib/seat.sh
source "$BRIDGIE_HOME/runner/lib/seat.sh"
# shellcheck source=../lib/git.sh
source "$BRIDGIE_HOME/runner/lib/git.sh"

# require_build_ack <root> <slug>: R9 pre-build half — risk levels whose policy needs a human ack.
require_build_ack() {
  local root="$1" slug="$2" needs
  needs="$(node_run state.mjs needs-ack "$root" "$slug")"
  [[ -z "$needs" ]] && return 0
  [[ "$(node_run flow.mjs ack-declined "$root" "$slug")" == "true" ]] && die "build: the risk acknowledgement for '$slug' was declined"
  [[ "$(node_run flow.mjs ack-recorded "$root" "$slug")" == "true" ]] && return 0
  node_run flow.mjs ensure-decision "$root" "$slug" ack_risk \
    "Bet '$slug' is risk '$needs'; policy requires a human acknowledgement before agents build or verify it." '["ack","decline"]' --risk "$needs" >/dev/null
  state_commit "$root" "ack requested for $slug"
  wait_human "build: waiting for a human ack of risk '$needs' (bridgie ack $slug, or bridgie open $slug)"
}

# produce <root> <slug> <task> <seat> <wt> [packet]: one producer run with all guards.
produce() {
  local root="$1" slug="$2" task="$3" seat="$4" wt="$5" packet="${6:-}" head run_dir changes
  head="$(git -C "$wt" rev-parse HEAD)"
  local args=("$slug" "$seat" --task "$task" --cwd "$wt")
  [[ -n "$packet" ]] && args+=(--packet "$packet")
  if ! run_dir="$(run_seat "${args[@]}")"; then
    git_reset_task "$wt" "$head"
    node_run flow.mjs fail-attempt "$root" "$slug" "$task" "${seat##*/} run failed (see .bridgie/runs/$slug)" >/dev/null
    state_commit "$root" "build $slug $task: ${seat##*/} failed"
    die "build: ${seat##*/} failed for $task; attempt recorded"
  fi
  changes="$(git_bridgie_changes "$root" "$slug" "$task")"
  if [[ -n "$changes" ]]; then
    git_reset_task "$wt" "$head"
    printf 'seat %s edited Bridgie state inside its worktree:\n%s\n' "${seat##*/}" "$changes" > "$run_dir/VIOLATION"
    node_run flow.mjs fail-attempt "$root" "$slug" "$task" "${seat##*/} edited .bridgie/ in its worktree; attempt discarded" >/dev/null
    state_commit "$root" "build $slug $task: violation"
    die "build: ${seat##*/} edited .bridgie/ in the worktree; attempt discarded (see $run_dir/VIOLATION)"
  fi
  node_run flow.mjs stamp-task "$run_dir/claim.json" "$task" >/dev/null
  git_commit_all "$wt" "bridgie: $task ${seat##*/} (run $(basename "$run_dir"))"
  printf '%s\n' "$run_dir"
}

cmd_build() {
  local slug="${1:-}"; shift || true
  [[ -n "$slug" ]] || die "usage: bridgie build <slug> [--task T] [--harden]"
  local want="" harden=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --task) want="$2"; shift 2 ;;
      --harden) harden=1; shift ;;
      *) die "build: unknown argument $1" ;;
    esac
  done
  local root; root="$(project_root)"
  [[ -f "$root/.bridgie/specs/$slug/tasks.json" ]] || die "build: no tasks for '$slug' (bridgie plan $slug)"
  git_on_feature "$root" "$slug"
  require_build_ack "$root" "$slug"

  local ready; ready="$(node_run flow.mjs ready-tasks "$root" "$slug")"
  local task
  if [[ -n "$want" ]]; then
    grep -qx "$want" <<< "$ready" || die "build: task $want is not ready (blocked, passed, out of attempts, or waiting on dependencies)"
    task="$want"
  else
    task="$(head -1 <<< "$ready")"
    [[ -n "$task" ]] || die "build: no ready tasks for '$slug' (bridgie status)"
  fi

  local wt; wt="$(git_task_worktree "$root" "$slug" "$task")"
  node_run flow.mjs start-attempt "$root" "$slug" "$task" "$(task_branch "$slug" "$task")" >/dev/null || exit 1
  local run_dir; run_dir="$(produce "$root" "$slug" "$task" build/implementer "$wt")" || exit 1

  local risk; risk="$(node_run state.mjs fm-get "$root/.bridgie/bets/$slug/bet.md" risk | tr -d '"')"
  if [[ "$harden" == "1" || "$risk" =~ ^(money|data|security|infra)$ ]]; then
    local packet; packet="$(mktemp -d)"
    git_diff_packet "$root" "$slug" "$task" "$packet"
    produce "$root" "$slug" "$task" build/hardener "$wt" "$packet" >/dev/null || exit 1
    rm -rf "$packet"
  fi
  node_run flow.mjs task-set "$root" "$slug" "$task" '{"status":"verify"}' >/dev/null
  state_commit "$root" "build $slug $task"
  log "built $task ($(basename "$run_dir")). Next: bridgie verify $slug"
}
