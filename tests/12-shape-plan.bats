#!/usr/bin/env bats
load helpers

setup() { export BRIDGIE_ADAPTER=fake; P="$(make_project --git)"; }

@test "shape refuses a bet that is not signed" {
  (cd "$P" && bridgie init && bridgie bet new b) >/dev/null 2>&1
  run bash -c "cd '$P' && bridgie shape b"
  [ "$status" -ne 0 ]
  [[ "$output" == *"must be signed"* ]]
}

@test "shape refuses uncommitted changes outside .bridgie" {
  signed_bet "$P" b
  echo dirty >> "$P/README.md"
  run bash -c "cd '$P' && bridgie shape b"
  [ "$status" -ne 0 ]
  [[ "$output" == *"uncommitted"* ]]
}

@test "shape writes requirements and design on bridgie/<slug> and raises approve_design" {
  signed_bet "$P" b
  run bash -c "cd '$P' && bridgie shape b"
  [ "$status" -eq 0 ]
  [ "$(git -C "$P" branch --show-current)" = "bridgie/b" ]
  grep -q '^## R2' "$P/.bridgie/specs/b/requirements.md"
  grep -q '^## Decision' "$P/.bridgie/specs/b/design.md"
  grep -q '"type": "approve_design"' "$P/.bridgie/decisions/b.json"
  [[ "$output" == *"R1 R2 P1"* ]]
}

@test "plan is refused until the design is approved, then writes mapped tasks" {
  signed_bet "$P" b
  (cd "$P" && bridgie shape b) >/dev/null 2>&1
  run bash -c "cd '$P' && bridgie plan b"
  [ "$status" -ne 0 ]
  [[ "$output" == *"not approved"* ]]
  run bash -c "cd '$P' && bridgie shape b --approve && bridgie plan b"
  [ "$status" -eq 0 ]
  [[ "$output" == *"2 task(s)"* ]]
  node "$BRIDGIE_HOME/runner/state.mjs" validate tasks "$P/.bridgie/specs/b/tasks.json"
  run bash -c "cd '$P' && bridgie shape b"
  [ "$status" -ne 0 ]
  [[ "$output" == *"already approved"* ]]
}

@test "request changes keeps the design unapproved and a re-shape raises a new approval" {
  signed_bet "$P" b
  (cd "$P" && bridgie shape b) >/dev/null 2>&1
  run bash -c "cd '$P' && bridgie shape b --changes 'split the migration'"
  [ "$status" -eq 0 ]
  grep -q 'changes requested: split the migration' "$P/.bridgie/bets/b/bet.md"
  run bash -c "cd '$P' && bridgie plan b"
  [ "$status" -ne 0 ]
  run bash -c "cd '$P' && bridgie shape b"
  [ "$status" -eq 0 ]
  [ -d "$P/.bridgie/runs/b/shaper-02" ]
  grep -q 'changes requested' "$P/.bridgie/runs/b/shaper-02/prompt.md"
}

@test "ack answers a pending risk acknowledgement" {
  signed_bet "$P" b
  printf '%s' '{"type":"ack_risk","context":"paths","options":["ack","decline"]}' | node "$BRIDGIE_HOME/runner/state.mjs" decision-add "$P" b - >/dev/null
  run bash -c "cd '$P' && bridgie ack b"
  [ "$status" -eq 0 ]
  [ "$(node "$BRIDGIE_HOME/runner/flow.mjs" ack-recorded "$P" b)" = "true" ]
}
