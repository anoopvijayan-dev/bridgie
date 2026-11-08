# shellcheck shell=bash
# Shared helpers for bridgie commands. Sourced by bin/bridgie.

die()  { printf 'bridgie: %s\n' "$*" >&2; exit 1; }
log()  { printf '%s\n' "$*" >&2; }
# wait_human: stop because a person must decide something (exit 3, not an error).
wait_human() { printf 'bridgie: %s\n' "$*" >&2; exit 3; }
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
  node "$BRIDGIE_HOME/runner/$mod" "$@"   # BRIDGIE_HOME is exported by bin/bridgie
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

Find     scout --from <folder> [--name N]   rank the problems in a folder of raw signals (bet-less)
Decide   bet new <slug> [--from <scout>/O<n>] [--risk R]   create a bet (optionally seeded from an opportunity)
         frame <slug> ["<idea>"]  draft the bet body; assumptions become questions
         research <slug>          competitors, prices, complaints from the web, every fact linked
         grill <slug> [--lenses]  stress-test the why; --lenses adds the three-lens board and chair
         lenses <slug>            the board on its own
         panel <slug> [--n N]     simulated buyer panel (objections and price range; not evidence)
         numbers <slug> [--template]   unit economics computed from numbers.yaml (required for money bets)
         evidence <slug>          plan real-world evidence; with material, synthesise and propose confidence
         decide <slug> <id> <answer> [--text "..."]
         sign <slug> [--kill | --more-evidence]
Build    shape | plan | build | run
Verify   verify
Accept   accept
Learn    learn
Tool     new <folder> [--lane L]   new project in one step        next (or just: bridgie)   what to do next
         init [--lane L]  status  open [slug] [--invite NAME]  doctor  version  help
USAGE
}

# json_get <json-string> <key> → value (strings unquoted)
json_get() {
  node -e 'const o=JSON.parse(process.argv[1]);const v=o[process.argv[2]];process.stdout.write(v===null||v===undefined?"":(typeof v==="string"?v:JSON.stringify(v)))' "$1" "$2"
}
