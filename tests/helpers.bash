# shellcheck shell=bash
# Shared setup for bats tests.
BRIDGIE_HOME="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export BRIDGIE_HOME
export PATH="$BRIDGIE_HOME/bin:$PATH"
export BRIDGIE_NO_COMMIT=1
export BRIDGIE_USER=tester

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
    [[ -d .bridgie ]] || bridgie init >/dev/null 2>&1
    bridgie bet new "$slug" --title "Net collection" --risk "$risk" >/dev/null 2>&1
    bridgie grill "$slug" >/dev/null 2>&1
    bridgie decide "$slug" D1 no >/dev/null 2>&1
    bridgie decide "$slug" D2 measured >/dev/null 2>&1
    node "$BRIDGIE_HOME/runner/state.mjs" fm-set ".bridgie/bets/$slug/bet.md" confidence '"test"' --schema bet
    bridgie sign "$slug" >/dev/null 2>&1
  )
  [[ "$(fm "$p/.bridgie/bets/$slug/bet.md" status)" == '"signed"' ]]
}
