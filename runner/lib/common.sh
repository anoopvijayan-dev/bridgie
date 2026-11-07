# shellcheck shell=bash
# Shared helpers for bridgie commands. Sourced by bin/bridgie.

die()  { printf 'bridgie: %s\n' "$*" >&2; exit 1; }
log()  { printf '%s\n' "$*" >&2; }
need_cmd() { command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"; }

# find_root: walk up from $PWD to a folder containing .bridgie/. Prints it, or returns 1.
find_root() {
  local d="$PWD"
  while [[ "$d" != "/" && -n "$d" ]]; do
    [[ -d "$d/.bridgie" ]] && { printf '%s\n' "$d"; return 0; }
    d="$(dirname "$d")"
  done
  return 1
}

# project_root: like find_root, but fails the command when there is no project.
project_root() {
  find_root || die "not inside a bridgie project (no .bridgie/ found); run 'bridgie init' first"
}

# node_run <module.mjs> args... → runs a runner module with BRIDGIE_HOME exported.
node_run() {
  local mod="$1"; shift
  BRIDGIE_HOME="$BRIDGIE_HOME" node "$BRIDGIE_HOME/runner/$mod" "$@"
}

# Who is acting: $BRIDGIE_USER, else git user.name, else $USER.
bridgie_user() {
  if [[ -n "${BRIDGIE_USER:-}" ]]; then printf '%s\n' "$BRIDGIE_USER"; return; fi
  local n; n="$(git config user.name 2>/dev/null || true)"
  printf '%s\n' "${n:-${USER:-unknown}}"
}

# state_commit <root> <message>: commit .bridgie changes if inside a git repo.
state_commit() {
  local root="$1" msg="$2"
  [[ "${BRIDGIE_NO_COMMIT:-0}" == "1" ]] && return 0
  git -C "$root" rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 0
  git -C "$root" add -A -- .bridgie >/dev/null 2>&1 || return 0
  git -C "$root" diff --cached --quiet -- .bridgie && return 0
  git -C "$root" commit -q -m "bridgie: $msg" -- .bridgie
}

usage() {
  cat <<'USAGE'
bridgie <command> [args]

Decide   bet new <slug>        create a bet
         grill <slug>          stress-test the bet; raises questions
         decide <slug> <id> <answer> [--text "..."]
         sign <slug> [--kill | --more-evidence]
Build    shape | plan | build  (M1)
Verify   verify                (M1)
Accept   accept                (M1)
Learn    learn                 (M1)
Tool     init [--lane L]  status  open [slug]  doctor  version  help
USAGE
}

# json_get <json-string> <key> → value (strings unquoted)
json_get() {
  node -e 'const o=JSON.parse(process.argv[1]);const v=o[process.argv[2]];process.stdout.write(v===null||v===undefined?"":(typeof v==="string"?v:JSON.stringify(v)))' "$1" "$2"
}
