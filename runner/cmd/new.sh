# shellcheck shell=bash
# bridgie new <folder> [--lane L] — a new project in one step: folder, git repository, Bridgie state.
# shellcheck source=./init.sh
source "$BRIDGIE_HOME/runner/cmd/init.sh"

cmd_new() {
  local folder="${1:-}"; shift || true
  [[ -n "$folder" && "$folder" != --* ]] || die "usage: bridgie new <folder> [--lane engineering|product|marketing|sales|platform|security]"
  need_cmd git; need_cmd node
  [[ -e "$folder/.bridgie" ]] && die "new: $folder already has a .bridgie folder (cd there and run: bridgie)"
  mkdir -p "$folder"
  if ! git -C "$folder" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git -C "$folder" init -q -b main 2>/dev/null || git -C "$folder" init -q
  fi
  (cd "$folder" && cmd_init "$@")
  local abs; abs="$(cd "$folder" && pwd)"
  log ""
  log "Ready. Next:"
  log "  cd $abs"
  log "  bridgie                      shows what to do next"
  log "  bridgie bet new <slug> --title \"...\"   or   bridgie scout --from <folder of notes>"
}
