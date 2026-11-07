#!/usr/bin/env bats
load helpers

setup() { P="$(make_project --git)"; bash -c "cd '$P' && bridgie init" >/dev/null; }

@test "bet new creates a draft bet with valid frontmatter and a decisions file" {
  run bash -c "cd '$P' && bridgie bet new net-collect --title 'Net collection' --risk money"
  [ "$status" -eq 0 ]
  [ -f "$P/.bridgie/bets/net-collect/bet.md" ]
  [ "$(fm "$P/.bridgie/bets/net-collect/bet.md" status)" = '"draft"' ]
  [ "$(fm "$P/.bridgie/bets/net-collect/bet.md" owner)" = '"tester"' ]
  [ "$(fm "$P/.bridgie/bets/net-collect/bet.md" risk)" = '"money"' ]
  [ -f "$P/.bridgie/decisions/net-collect.json" ]
  run node "$BRIDGIE_HOME/runner/state.mjs" validate bet "$P/.bridgie/bets/net-collect/bet.md"
  [ "$status" -eq 0 ]
}

@test "bet new rejects a bad slug and a duplicate" {
  run bash -c "cd '$P' && bridgie bet new 'Bad Slug'"
  [ "$status" -ne 0 ]
  bash -c "cd '$P' && bridgie bet new dup"
  run bash -c "cd '$P' && bridgie bet new dup"
  [ "$status" -ne 0 ]
  [[ "$output" == *"exists"* ]]
}

@test "bet subcommand other than new is rejected" {
  run bash -c "cd '$P' && bridgie bet frobnicate x"
  [ "$status" -ne 0 ]
}
