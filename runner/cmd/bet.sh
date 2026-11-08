# shellcheck shell=bash
# bridgie bet new <slug> [--title T] [--lane L] [--risk R] [--from <scout>/O<n>]

cmd_bet() {
  local sub="${1:-}"; shift || true
  case "$sub" in
    new) bet_new "$@" ;;
    *) die "bet: expected 'new <slug>' (got '${sub:-nothing}')" ;;
  esac
}

bet_new() {
  local slug="${1:-}"; shift || true
  [[ -n "$slug" ]] || die "bet new: slug required"
  local root; root="$(project_root)"
  local title="$slug" lane="" risk="none" from=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --title) title="$2"; shift 2 ;;
      --lane) lane="$2"; shift 2 ;;
      --risk) risk="$2"; shift 2 ;;
      --from) from="$2"; shift 2 ;;
      *) die "bet new: unknown argument $1" ;;
    esac
  done
  if [[ -z "$lane" ]]; then
    lane="$(node_run state.mjs policy "$root" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).default_lane||"engineering"))')"
  fi
  local file
  file="$(node_run state.mjs bet-new "$root" "$slug" --title "$title" --lane "$lane" --risk "$risk" --owner "$(bridgie_user)")" || exit 1
  if [[ -n "$from" ]]; then
    node_run decide.mjs seed-bet "$root" "$slug" "$from" >/dev/null || exit 1
    state_commit "$root" "bet new $slug (from $from)"
    log "created ${file#"$root"/} from $from (lane: $lane, risk: $risk). Next: bridgie frame $slug"
    return
  fi
  state_commit "$root" "bet new $slug"
  log "created ${file#"$root"/} (lane: $lane, risk: $risk). Fill in the body, then: bridgie frame $slug \"<idea>\"   or   bridgie grill $slug"
}
