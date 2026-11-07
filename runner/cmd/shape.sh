# shellcheck shell=bash
# bridgie shape <slug> [--approve | --changes "<what to change>"]
# Starts bridgie/<slug>, runs the shaper (requirements.md + design.md), raises approve_design.
# shellcheck source=../lib/seat.sh
source "$BRIDGIE_HOME/runner/lib/seat.sh"
# shellcheck source=../lib/git.sh
source "$BRIDGIE_HOME/runner/lib/git.sh"

cmd_shape() {
  local slug="${1:-}"; shift || true
  [[ -n "$slug" ]] || die "usage: bridgie shape <slug> [--approve | --changes \"...\"]"
  local mode="run" text=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --approve) mode="approve"; shift ;;
      --changes) mode="changes"; text="$2"; shift 2 ;;
      *) die "shape: unknown argument $1" ;;
    esac
  done
  local root; root="$(project_root)"
  local status; status="$(node_run state.mjs fm-get "$root/.bridgie/bets/$slug/bet.md" status | tr -d '"')"
  [[ "$status" == "signed" ]] || die "shape: bet '$slug' is '$status'; it must be signed first (bridgie open $slug)"

  if [[ "$mode" != "run" ]]; then
    local id; id="$(node_run flow.mjs pending-of-type "$root" "$slug" approve_design | head -1)"
    [[ -n "$id" ]] || die "shape: no design waiting for approval (run bridgie shape $slug)"
    if [[ "$mode" == "approve" ]]; then
      node_run flow.mjs decision-answer "$root" "$slug" "$id" approve --by "$(bridgie_user)" >/dev/null || exit 1
      log "design approved ($id). Next: bridgie plan $slug"
    else
      node_run flow.mjs decision-answer "$root" "$slug" "$id" "request changes" --text "$text" --by "$(bridgie_user)" >/dev/null || exit 1
      log "changes requested ($id). Re-run: bridgie shape $slug"
    fi
    state_commit "$root" "shape $slug: $mode"
    return
  fi

  [[ "$(node_run flow.mjs design-approved "$root" "$slug")" == "true" ]] && die "shape: design for '$slug' is already approved; next is bridgie plan $slug"
  git_is_repo "$root" || die "shape: $root is not a git repository; Build needs one (git init)"
  git_require_clean "$root"
  local base; base="$(git_feature_start "$root" "$slug")"
  local run_dir; run_dir="$(run_seat "$slug" build/shaper)" || exit 1
  local ids; ids="$(node_run flow.mjs write-spec "$root" "$slug" "$run_dir/seat-output.json")" || die "shape: shaper output rejected"
  node_run state.mjs ingest-questions "$root" "$slug" "$run_dir/seat-output.json" --run "$(basename "$run_dir")" >/dev/null
  node_run flow.mjs ensure-decision "$root" "$slug" approve_design \
    "Approve the design and requirements ($ids) for '$slug'? Branch bridgie/$slug from $base." '["approve","request changes"]' >/dev/null
  state_commit "$root" "shape $slug ($(basename "$run_dir"))"
  log "shaped $slug on branch bridgie/$slug (from $base): requirements $ids. Review and approve: bridgie open $slug   (or: bridgie shape $slug --approve)"
}
