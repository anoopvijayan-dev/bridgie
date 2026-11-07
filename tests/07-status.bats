#!/usr/bin/env bats
load helpers

@test "status lists bets and pending decisions" {
  export BRIDGIE_ADAPTER=fake
  P="$(make_project)"
  bash -c "cd '$P' && bridgie init && bridgie bet new one --title 'First bet' && bridgie bet new two --title 'Second' --risk money && bridgie grill two" >/dev/null
  run bash -c "cd '$P' && bridgie status"
  [ "$status" -eq 0 ]
  [[ "$output" == *"SLUG"* ]]
  [[ "$output" == *"one"*"draft"* ]]
  [[ "$output" == *"two"*"evidence"* ]]
  [[ "$output" == *"decision(s) waiting"* ]]
  [[ "$output" == *"D1"* ]]
}

@test "status in an empty project" {
  P="$(make_project)"
  bash -c "cd '$P' && bridgie init" >/dev/null
  run bash -c "cd '$P' && bridgie status"
  [ "$status" -eq 0 ]
  [[ "$output" == *"No bets yet"* ]]
}
