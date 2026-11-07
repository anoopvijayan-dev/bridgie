# shellcheck shell=bash
# bridgie decide <slug> <id> <answer> [--text "free text"]

cmd_decide() {
  local slug="${1:-}" id="${2:-}" answer="${3:-}"
  [[ -n "$slug" && -n "$id" && -n "$answer" ]] || die "usage: bridgie decide <slug> <id> <answer> [--text '...']"
  shift 3
  local text=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --text) text="$2"; shift 2 ;;
      *) die "decide: unknown argument $1" ;;
    esac
  done
  local root; root="$(project_root)"
  local res
  if [[ -n "$text" ]]; then
    res="$(node_run state.mjs decision-answer "$root" "$slug" "$id" "$answer" --text "$text" --by "$(bridgie_user)")" || exit 1
  else
    res="$(node_run state.mjs decision-answer "$root" "$slug" "$id" "$answer" --by "$(bridgie_user)")" || exit 1
  fi
  state_commit "$root" "decide $slug $id: $answer"
  log "$id → $answer ($(printf '%s' "$res" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).effect||""))'))"
}
