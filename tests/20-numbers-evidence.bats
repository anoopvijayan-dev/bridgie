#!/usr/bin/env bats
load helpers

setup() {
  export BRIDGIE_ADAPTER=fake
  P="$(make_project --git)"
  bash -c "cd '$P' && bridgie init --lane product && bridgie bet new b --title 'Statement packs' --risk money && bridgie grill b && bridgie decide b D1 no && bridgie decide b D2 measured" >/dev/null 2>&1
  node "$BRIDGIE_HOME/runner/state.mjs" fm-set "$P/.bridgie/bets/b/bet.md" confidence '"data"' --schema bet
}

@test "numbers: template, computed verdict, and the sign gate for money bets" {
  run bash -c "cd '$P' && bridgie sign b"
  [ "$status" -ne 0 ]
  [[ "$output" == *"requires unit economics"* ]]
  run bash -c "cd '$P' && bridgie numbers b"
  [ "$status" -ne 0 ]
  [[ "$output" == *"--template"* ]]
  run bash -c "cd '$P' && bridgie numbers b --template"
  [ "$status" -eq 0 ]
  [ -f "$P/.bridgie/bets/b/numbers.yaml" ]
  run bash -c "cd '$P' && bridgie numbers b"
  [ "$status" -eq 0 ]
  [[ "$output" == *"profitable on these inputs"* ]]
  grep -q '"verdict": "profitable"' "$P/.bridgie/bets/b/numbers.json"
  grep -q '## Year 1 by month' "$P/.bridgie/bets/b/numbers.md"
  run bash -c "cd '$P' && bridgie sign b"
  [ "$status" -eq 0 ]
  [ "$(fm "$P/.bridgie/bets/b/bet.md" status)" = '"signed"' ]
}

@test "numbers: a unit that loses money is 'not yet' and still blocks signing" {
  bash -c "cd '$P' && bridgie numbers b --template" >/dev/null
  sed -i 's/^variable_cost: .*/variable_cost: 50/' "$P/.bridgie/bets/b/numbers.yaml"
  run bash -c "cd '$P' && bridgie numbers b"
  [ "$status" -eq 0 ]
  [[ "$output" == *"not yet"* ]] && [[ "$output" == *"unit_positive"* ]]
  run bash -c "cd '$P' && bridgie sign b"
  [ "$status" -ne 0 ]
  [[ "$output" == *"loses money"* ]]
}
