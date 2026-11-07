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
  local res args=(--by "$(bridgie_user)")
  [[ -n "$text" ]] && args+=(--text "$text")
  local sha; sha="$(git -C "$root" rev-parse -q --verify "bridgie/$slug" 2>/dev/null || true)"
  [[ -n "$sha" ]] && args+=(--sha "$sha")
  res="$(node_run flow.mjs decision-answer "$root" "$slug" "$id" "$answer" "${args[@]}")" || exit 1
  state_commit "$root" "decide $slug $id: $answer"
  log "$id → $answer ($(printf '%s' "$res" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).effect||""))'))"
}
