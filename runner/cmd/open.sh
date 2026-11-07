# shellcheck shell=bash
# bridgie open [slug] [--port N] [--host H] [--invite NAME]... [--no-browser] [--static]
# Live: serves the decision surface on localhost and opens the browser with your access link.
# --invite NAME: an extra identity (for example a second approver) with its own link.
# --static: writes read-only pages to .bridgie/ui/ and prints the path.

cmd_open() {
  local slug="" port=0 host="127.0.0.1" browser=1 static=0 invites=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --port) port="$2"; shift 2 ;;
      --host) host="$2"; shift 2 ;;
      --invite) invites+=(--invite "$2"); shift 2 ;;
      --no-browser) browser=0; shift ;;
      --static) static=1; shift ;;
      --*) die "open: unknown argument $1" ;;
      *) slug="$1"; shift ;;
    esac
  done
  local root; root="$(project_root)"
  need_cmd node
  if [[ "$static" == "1" ]]; then
    node_run surface.mjs render --root "$root"
    return
  fi
  local args=(serve --root "$root" --port "$port" --host "$host" --by "$(bridgie_user)")
  [[ -n "$slug" ]] && args+=(--path "/bet/$slug")
  [[ ${#invites[@]} -gt 0 ]] && args+=("${invites[@]}")
  [[ "$browser" == "1" ]] && args+=(--open)
  exec node "$BRIDGIE_HOME/runner/surface.mjs" "${args[@]}"
}
