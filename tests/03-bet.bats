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

@test "bet set changes risk, owner and appetite before signing, and logs each change" {
  bash -c "cd '$P' && bridgie bet new game --risk money" >/dev/null
  run bash -c "cd '$P' && bridgie bet set game --risk ux --owner anoop --time 6w --tokens-usd 150 --reason 'free game, no real money'"
  [ "$status" -eq 0 ]
  B="$P/.bridgie/bets/game/bet.md"
  [ "$(fm "$B" risk)" = '"ux"' ]
  [ "$(fm "$B" owner)" = '"anoop"' ]
  [ "$(fm "$B" appetite)" = '{"time":"6w","tokens_usd":150}' ]
  grep -q 'risk money → ux: free game, no real money' "$B"
  grep -q 'owner tester → anoop: free game, no real money' "$B"
  grep -q 'appetite 2w/\$20 → 6w/\$150: free game, no real money' "$B"
  run node "$BRIDGIE_HOME/runner/state.mjs" validate bet "$B"
  [ "$status" -eq 0 ]
}

@test "bet set needs a reason and at least one change" {
  bash -c "cd '$P' && bridgie bet new game" >/dev/null
  run bash -c "cd '$P' && bridgie bet set game --risk ux"
  [ "$status" -ne 0 ]
  [[ "$output" == *"--reason"* ]]
  run bash -c "cd '$P' && bridgie bet set game --reason x"
  [ "$status" -ne 0 ]
  run bash -c "cd '$P' && bridgie bet set game --risk lots --reason x"
  [ "$status" -ne 0 ]
  [[ "$output" == *"unknown risk"* ]]
  run bash -c "cd '$P' && bridgie bet set game --tokens-usd abc --reason x"
  [ "$status" -ne 0 ]
}

@test "bet set is refused once the bet is signed" {
  export BRIDGIE_ADAPTER=fake
  signed_bet "$P" done-bet money
  run bash -c "cd '$P' && bridgie bet set done-bet --risk none --reason 'try to lower'"
  [ "$status" -ne 0 ]
  [[ "$output" == *"signed"* ]]
  [ "$(fm "$P/.bridgie/bets/done-bet/bet.md" risk)" = '"money"' ]
}

@test "bet set inside an agent must say it relays a person" {
  bash -c "cd '$P' && bridgie bet new game --risk money" >/dev/null
  run bash -c "cd '$P' && BRIDGIE_HARNESS=claude-code bridgie bet set game --risk ux --reason r"
  [ "$status" -ne 0 ]
  [[ "$output" == *"--relayed"* ]]
  run bash -c "cd '$P' && BRIDGIE_HARNESS=claude-code bridgie bet set game --risk ux --reason r --relayed"
  [ "$status" -eq 0 ]
  grep -q 'risk money → ux: r (.*relayed' "$P/.bridgie/bets/game/bet.md"
}
