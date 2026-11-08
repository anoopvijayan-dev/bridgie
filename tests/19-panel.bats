#!/usr/bin/env bats
load helpers

setup() {
  export BRIDGIE_ADAPTER=fake
  P="$(make_project --git)"
  bash -c "cd '$P' && bridgie init --lane product && bridgie bet new b --title 'Statement packs'" >/dev/null
}

@test "first run drafts the customer profile and the pitch, then stops for the owner (exit 3)" {
  run bash -c "cd '$P' && bridgie panel b --n 6"
  [ "$status" -eq 3 ]
  [[ "$output" == *"Review and correct them"* ]]
  [ -f "$P/.bridgie/bets/b/customer.yaml" ]
  [ -f "$P/.bridgie/bets/b/pitch.md" ]
  grep -q 'solo broker' "$P/.bridgie/bets/b/customer.yaml"
  [ "$(fm "$P/.bridgie/bets/b/bet.md" confidence)" = '"opinion"' ]   # the profiler's confidence proposal is ignored
  [ ! -d "$P/.bridgie/runs/b/panel-01" ]
}

@test "second run deals cards, runs one buyer per card in a swarm, tallies, excludes bad answers, and asks for real buyers" {
  bash -c "cd '$P' && bridgie panel b" >/dev/null 2>&1 || true
  run bash -c "cd '$P' && bridgie panel b --n 6 --seed 3"
  [ "$status" -eq 0 ]
  [[ "$output" == *"6 buyers dealt (seed 3)"* ]]
  [[ "$output" == *"buy rate 0.6 over 5 answers (1 excluded)"* ]]
  D="$P/.bridgie/runs/b/panel-01"
  [ -f "$D/cards.json" ]
  for i in 01 02 03 04 05 06; do [ -f "$D/buyers/B$i/prompt.md" ]; done
  grep -q '"id": "B02"' "$D/buyers/B02/prompt.md"
  grep -q 'the pitch, exactly as every buyer sees it' "$D/buyers/B02/prompt.md"
  grep -q '"card": "B02"' "$D/buyers/B02/buyer-answer.json"
  grep -q 'B05: prices must rise' "$P/.bridgie/bets/b/panel.md"
  grep -q '"buy_rate": 0.6' "$P/.bridgie/bets/b/panel.json"
  grep -q 'E-panel: confirm' "$P/.bridgie/bets/b/bet.md"
  grep -q 'upper bound' "$P/.bridgie/bets/b/panel.md"
  [ ! -d "$P/.bridgie/.seat-lock" ]
  [ "$(fm "$P/.bridgie/bets/b/bet.md" confidence)" = '"opinion"' ]
}

@test "the panel respects the policy ceiling and the decide-loop status gate" {
  run bash -c "cd '$P' && bridgie panel b --n 500"
  [ "$status" -ne 0 ]
  [[ "$output" == *"above the policy ceiling"* ]]
  signed_bet "$P" s
  run bash -c "cd '$P' && bridgie panel s --n 3"
  [ "$status" -ne 0 ]
  [[ "$output" == *"decide loop is closed"* ]]
}

@test "a buyer that fails twice is excluded and the swarm still completes" {
  bash -c "cd '$P' && bridgie panel b" >/dev/null 2>&1 || true
  run bash -c "cd '$P' && BRIDGIE_FAKE_FAIL_CARDS=B03 bridgie panel b --n 4"
  [ "$status" -eq 0 ]
  [[ "$output" == *"3 buyer run(s) finished, 1 failed twice"* ]]
  grep -q 'B03: no answer' "$P/.bridgie/bets/b/panel.md"
  [ ! -d "$P/.bridgie/runs/b/panel-01/buyers/B03" ]
  [ ! -d "$P/.bridgie/.seat-lock" ]
}
