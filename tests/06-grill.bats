#!/usr/bin/env bats
load helpers

setup() {
  export BRIDGIE_ADAPTER=fake
  P="$(make_project --git)"
  bash -c "cd '$P' && bridgie init && bridgie bet new b --title 'Net collect' --risk none" >/dev/null
}

@test "grill runs the seat, raises questions as decisions, adds a sign decision, moves to evidence" {
  run bash -c "cd '$P' && bridgie grill b"
  [ "$status" -eq 0 ]
  [ "$(fm "$P/.bridgie/bets/b/bet.md" status)" = '"evidence"' ]
  grep -q '"id": "D1"' "$P/.bridgie/decisions/b.json"
  grep -q '"id": "D2"' "$P/.bridgie/decisions/b.json"
  grep -q '"type": "sign"' "$P/.bridgie/decisions/b.json"
  grep -q -- '- D1: Does anyone retry' "$P/.bridgie/bets/b/bet.md"
  [ -f "$P/.bridgie/runs/b/grill-01/seat-output.json" ]
  [[ "$output" == *"2 question"* ]]
  [[ "$output" == *"bridgie open b"* ]]
}

@test "grill from evidence re-grills and appends new questions" {
  bash -c "cd '$P' && bridgie grill b" >/dev/null
  run bash -c "cd '$P' && bridgie grill b"
  [ "$status" -eq 0 ]
  grep -q '"id": "D4"' "$P/.bridgie/decisions/b.json"
  [ -d "$P/.bridgie/runs/b/grill-02" ]
}

@test "grill refuses a signed or killed bet" {
  bash -c "cd '$P' && bridgie grill b && bridgie decide b D1 no && bridgie decide b D2 measured && bridgie sign b" >/dev/null
  run bash -c "cd '$P' && bridgie grill b"
  [ "$status" -ne 0 ]
  [[ "$output" == *"signed"* ]]
}

@test "a failing grill run leaves the bet in draft and no decisions" {
  run bash -c "cd '$P' && BRIDGIE_FAKE_EXIT=3 bridgie grill b"
  [ "$status" -ne 0 ]
  [ "$(fm "$P/.bridgie/bets/b/bet.md" status)" = '"draft"' ]
  ! grep -q '"id": "D1"' "$P/.bridgie/decisions/b.json"
}
