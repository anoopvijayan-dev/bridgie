# shellcheck shell=bash
# bridgie scout --from <folder> [--name N] — rank the problems in a folder of raw signals.
# Bet-less: writes .bridgie/scout/<N>/opportunities.md; seed a bet with: bridgie bet new <slug> --from <N>/O1
# shellcheck source=../lib/seat.sh
source "$BRIDGIE_HOME/runner/lib/seat.sh"

cmd_scout() {
  local from="" name=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --from) from="$2"; shift 2 ;;
      --name) name="$2"; shift 2 ;;
      *) die "scout: unknown argument $1" ;;
    esac
  done
  [[ -n "$from" ]] || die "usage: bridgie scout --from <folder> [--name N]"
  [[ -d "$from" ]] || die "scout: $from is not a folder"
  from="$(cd "$from" && pwd)"
  local root; root="$(project_root)"
  [[ -n "$name" ]] || name="$(basename "$from" | tr '[:upper:]_ ' '[:lower:]--' | tr -cd 'a-z0-9-')"
  local packet; packet="$(mktemp -d)"
  local collected; collected="$(node_run decide.mjs collect-signals "$from" "$packet")" || die "scout: could not read $from"
  local files; files="$(node -e 'console.log(JSON.parse(process.argv[1]).copied.length)' "$collected")"
  [[ "$files" -gt 0 ]] || die "scout: no text files (.md .txt .csv .json .yaml .eml .log .html) found under $from"
  log "scouting $files file(s) from $from as '$name'"
  local run_dir
  run_dir="$(BRIDGIE_RUNS_DIR="$root/.bridgie/runs/_scout/$name" run_seat _scout decide/scout --packet "$packet")" || exit 1
  rm -rf "$packet"
  local list; list="$(node_run decide.mjs write-opportunities "$root" "$name" "$run_dir/seat-output.json" --from "$from" --files "$files")" || die "scout: output rejected (see $run_dir)"
  state_commit "$root" "scout $name"
  log "opportunities written to .bridgie/scout/$name/opportunities.md:"
  printf '%s\n' "$list" | sed 's/^/  /'
  log "Next: bridgie bet new <slug> --from $name/O1   then   bridgie frame <slug>"
}
