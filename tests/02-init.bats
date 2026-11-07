#!/usr/bin/env bats
load helpers

@test "init creates .bridgie tree and touches nothing else (R1)" {
  dir="$(make_project --git)"
  before="$(git -C "$dir" status --porcelain)"
  run bash -c "cd '$dir' && bridgie init --lane engineering"
  [ "$status" -eq 0 ]
  for d in bets specs runs acceptance decisions learn; do [ -d "$dir/.bridgie/$d" ]; done
  [ -f "$dir/.bridgie/policy.yaml" ]
  [ -f "$dir/.bridgie/.gitignore" ]
  # only .bridgie appears as new; README.md untouched
  after="$(git -C "$dir" status --porcelain | grep -v '^?? .bridgie/' || true)"
  [ "$after" = "$before" ]
}

@test "init works in a folder that is not a git repository" {
  dir="$(make_project)"
  run bash -c "cd '$dir' && bridgie init"
  [ "$status" -eq 0 ]
  [ -d "$dir/.bridgie/bets" ]
}

@test "init refuses to run twice" {
  dir="$(make_project)"
  bash -c "cd '$dir' && bridgie init"
  run bash -c "cd '$dir' && bridgie init"
  [ "$status" -ne 0 ]
  [[ "$output" == *"already"* ]]
}

@test "project policy from init validates when merged" {
  dir="$(make_project)"
  bash -c "cd '$dir' && bridgie init --lane marketing"
  run node "$BRIDGIE_HOME/runner/state.mjs" policy "$dir"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"marketing"'* ]]
}
