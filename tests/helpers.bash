# shellcheck shell=bash
# Shared setup for bats tests.
BRIDGIE_HOME="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export BRIDGIE_HOME
export PATH="$BRIDGIE_HOME/bin:$PATH"
export BRIDGIE_NO_COMMIT=1
export BRIDGIE_USER=tester
export BRIDGIE_HARNESS=none   # tests act as a person at a terminal, whatever runs the suite
export BRIDGIE_USER_POLICY=/nonexistent/bridgie-user-policy.yaml   # isolate tests from ~/.bridgie

make_project() {            # make_project [--git] → prints path
  local dir; dir="$(mktemp -d)"
  if [[ "${1:-}" == "--git" ]]; then
    git -C "$dir" init -q -b main
    git -C "$dir" config user.email t@example.com
    git -C "$dir" config user.name tester
    echo "hello" > "$dir/README.md"
    git -C "$dir" add -A && git -C "$dir" commit -q -m init
  fi
  echo "$dir"
}

fm() {                      # fm <file> <key> → frontmatter value as JSON
  node "$BRIDGIE_HOME/runner/state.mjs" fm-get "$1" "$2"
}

# signed_bet <project> <slug> [risk]: init (if needed), bet, grill (fake), answer, sign. Needs BRIDGIE_ADAPTER=fake.
signed_bet() {
  local p="$1" slug="$2" risk="${3:-none}"
  (
    cd "$p" || exit 1
    if [[ ! -d .bridgie ]]; then
      bridgie init >/dev/null 2>&1
      printf "verify:\n  commands:\n    mechanical: ['node -e 0']\n    specified: ['node -e 0']\n" >> .bridgie/policy.yaml   # tiers required at risk none
    fi
    bridgie bet new "$slug" --title "Net collection" --risk "$risk" >/dev/null 2>&1
    bridgie grill "$slug" >/dev/null 2>&1
    bridgie decide "$slug" D1 no >/dev/null 2>&1
    bridgie decide "$slug" D2 measured >/dev/null 2>&1
    node "$BRIDGIE_HOME/runner/state.mjs" fm-set ".bridgie/bets/$slug/bet.md" confidence '"test"' --schema bet
    if [[ "$risk" == "money" ]]; then   # money bets need unit economics before signing
      bridgie numbers "$slug" --template >/dev/null 2>&1 && bridgie numbers "$slug" >/dev/null 2>&1
    fi
    bridgie sign "$slug" >/dev/null 2>&1
  )
  [[ "$(fm "$p/.bridgie/bets/$slug/bet.md" status)" == '"signed"' ]]
}

# planned_bet <project> <slug> [risk]: signed → shaped → approved → planned (fake adapter).
planned_bet() {
  signed_bet "$@" || return 1
  (cd "$1" && bridgie shape "$2" && bridgie shape "$2" --approve && bridgie plan "$2") >/dev/null 2>&1
  [[ -f "$1/.bridgie/specs/$2/tasks.json" ]]
}

# task_field <project> <slug> <task> <field>
task_field() { node -e 'const t=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).tasks.find(x=>x.id===process.argv[2]);console.log(JSON.stringify(t[process.argv[3]]))' "$1/.bridgie/specs/$2/tasks.json" "$3" "$4"; }

# all_tiers <project>: give every verification tier a trivially passing command (risky bets need them).
all_tiers() {
  printf "verify:\n  commands:\n" >> "$1/.bridgie/policy.yaml"
  for t in mechanical specified contracts invariants behavioural dual_run; do printf "    %s: ['node -e 0']\n" "$t" >> "$1/.bridgie/policy.yaml"; done
}

# policy_changed <project> <slug>: the owner accepts a change made to policy.yaml after the bet was
# signed (the governance lock would otherwise stop build, verify and accept). No-op without drift.
policy_changed() {
  local id; id="$(node "$BRIDGIE_HOME/runner/flow.mjs" governance-gate "$1" "$2" 2>/dev/null)" || return 0
  [[ -z "$id" ]] || (cd "$1" && bridgie decide "$2" "$id" "accept the change") >/dev/null 2>&1
}

# --- cross-platform helpers (tests also run in Git Bash on Windows and on macOS) ---------------------
on_windows() { [[ "${OSTYPE:-}" == msys* || "${OSTYPE:-}" == cygwin* ]]; }
native() {                  # native <path>: the form a Node process sees (C:\... on Windows)
  if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s\n' "$1"; fi
}
has_path_line() {           # has_path_line <file> <prefix> <path>: a line equal to prefix+path in any spelling
  local alts=("$3")
  command -v cygpath >/dev/null 2>&1 && alts+=("$(cygpath -m "$3")" "$(cygpath -w "$3")")
  [[ -d "$3" ]] && alts+=("$(cd "$3" && pwd -P)")
  node -e '
    const [f, pre, ...ps] = process.argv.slice(1);
    const n = s => s.replace(/\\/g, "/").toLowerCase();
    process.exit(require("fs").readFileSync(f, "utf8").split(/\r?\n/).some(l => ps.some(p => n(l) === n(pre + p))) ? 0 : 1);' "$1" "$2" "${alts[@]}"
}
make_cli_stub() {           # make_cli_stub <dir> <name> <stub.mjs>: an executable <name> that runs node <stub.mjs> <name> args
  if on_windows; then
    printf '@node "%s" %s %%*\r\n' "$(native "$3")" "$2" > "$1/$2.cmd"
  else
    printf '#!/bin/sh\nexec node "%s" %s "$@"\n' "$3" "$2" > "$1/$2"; chmod +x "$1/$2"
  fi
}
