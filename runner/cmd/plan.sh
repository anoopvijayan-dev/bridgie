# shellcheck shell=bash
# bridgie plan <slug> — decomposer turns the approved design into tasks.json.
# shellcheck source=../lib/seat.sh
source "$BRIDGIE_HOME/runner/lib/seat.sh"

cmd_plan() {
  local slug="${1:-}"; [[ -n "$slug" ]] || die "usage: bridgie plan <slug>"
  local root; root="$(project_root)"
  [[ "$(node_run flow.mjs design-approved "$root" "$slug")" == "true" ]] || die "plan: the design for '$slug' is not approved (bridgie open $slug)"
  local run_dir; run_dir="$(run_seat "$slug" build/decomposer)" || exit 1
  node_run flow.mjs write-tasks "$root" "$slug" "$run_dir/seat-output.json" >/dev/null || die "plan: decomposer output rejected; see $run_dir"
  state_commit "$root" "plan $slug ($(basename "$run_dir"))"
  local n; n="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).tasks.length)' "$root/.bridgie/specs/$slug/tasks.json")"
  log "planned $slug: $n task(s). Next: bridgie build $slug   (or bridgie run $slug)"
}
