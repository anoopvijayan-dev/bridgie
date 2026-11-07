# shellcheck shell=bash
# bridgie doctor — validate the tool, and the project when inside one.

cmd_doctor() {
  need_cmd node
  local root=""
  root="$(find_root || true)"
  if [[ -n "$root" ]]; then node_run doctor.mjs --root "$root"; else node_run doctor.mjs; fi
}
