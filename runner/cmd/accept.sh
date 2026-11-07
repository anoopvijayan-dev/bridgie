# shellcheck shell=bash
# bridgie accept <slug> [--approve | --conditions "<conditions>" | --reject "<reason>"]
# Without flags: packages the acceptance page (R6: every task passed). With a flag: answers it.
# shellcheck source=../lib/seat.sh
source "$BRIDGIE_HOME/runner/lib/seat.sh"
# shellcheck source=../lib/git.sh
source "$BRIDGIE_HOME/runner/lib/git.sh"

cmd_accept() {
  local slug="${1:-}"; shift || true
  [[ -n "$slug" ]] || die "usage: bridgie accept <slug> [--approve | --conditions \"...\" | --reject \"...\"]"
  local ans="" text=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --approve) ans="approve"; shift ;;
      --conditions) ans="approve with conditions"; text="$2"; shift 2 ;;
      --reject) ans="reject"; text="$2"; shift 2 ;;
      *) die "accept: unknown argument $1" ;;
    esac
  done
  local root; root="$(project_root)"
  local sha; sha="$(git -C "$root" rev-parse -q --verify "bridgie/$slug" 2>/dev/null || true)"

  if [[ -n "$ans" ]]; then
    local id; id="$(node_run flow.mjs pending-of-type "$root" "$slug" accept | head -1)"
    [[ -n "$id" ]] || die "accept: nothing waiting for acceptance on '$slug' (run bridgie accept $slug first)"
    local args=(--by "$(bridgie_user)")
    [[ -n "$text" ]] && args+=(--text "$text")
    [[ -n "$sha" ]] && args+=(--sha "$sha")
    local res; res="$(node_run flow.mjs decision-answer "$root" "$slug" "$id" "$ans" "${args[@]}")" || exit 1
    state_commit "$root" "accept $slug: $ans"
    log "$id → $ans: $(json_get "$res" effect)"
    return
  fi

  [[ "$(node_run flow.mjs all-passed "$root" "$slug")" == "true" ]] || die "accept: every task of '$slug' must pass first (R6); see bridgie status"
  if [[ -n "$(node_run flow.mjs pending-of-type "$root" "$slug" accept)" ]]; then
    local stale; stale="$(node_run flow.mjs stale-package "$root" "$slug")"
    [[ -n "$stale" ]] || die "accept: '$slug' is already waiting for a decision (bridgie open $slug)"
    log "the previous acceptance package is stale ($stale); building a new one"
  fi
  git_on_feature "$root" "$slug"
  local base; base="$(git -C "$root" config "branch.bridgie/$slug.bridgieBase" || echo main)"
  local packet; packet="$(mktemp -d)"
  git -C "$root" diff --stat "$base" "bridgie/$slug" -- . ':(exclude).bridgie' ':(exclude).bridgie/**' > "$packet/diff-stat.txt" 2>/dev/null || true
  local cost; cost="$(node_run flow.mjs acceptance-packet "$root" "$slug" "$packet/acceptance-packet.md" "$packet/diff-stat.txt")"
  local run_dir; run_dir="$(run_seat "$slug" accept/packager --packet "$packet")" || exit 1
  rm -rf "$packet"
  node_run flow.mjs write-acceptance "$root" "$slug" "$run_dir/seat-output.json" "$cost" >/dev/null || die "accept: packager output rejected"
  state_commit "$root" "accept $slug: packaged"
  log "acceptance package ready for $slug. Decide: bridgie open $slug   (or: bridgie accept $slug --approve)"
}
