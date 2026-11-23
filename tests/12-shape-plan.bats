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

@test "amend re-opens an approved design; the plan stays and a re-approval resumes it" {
  signed_bet "$P" b
  (cd "$P" && bridgie shape b && bridgie shape b --approve && bridgie plan b) >/dev/null 2>&1
  run bash -c "cd '$P' && bridgie shape b --amend ''"
  [ "$status" -ne 0 ]
  run bash -c "cd '$P' && bridgie shape b --amend 'R2: ambiguous lines go to the queue'"
  [ "$status" -eq 0 ]
  [[ "$output" == *"re-opened"* ]]
  grep -q 'changes requested: R2: ambiguous lines go to the queue' "$P/.bridgie/bets/b/bet.md"
  [ "$(node "$BRIDGIE_HOME/runner/flow.mjs" design-approved "$P" b)" = "false" ]
  run bash -c "cd '$P' && bridgie shape b"
  [ "$status" -eq 0 ]
  [[ "$output" != *"no longer has"* ]]
  grep -q 'R2: ambiguous lines go to the queue' "$P/.bridgie/runs/b/shaper-02/prompt.md"
  run bash -c "cd '$P' && bridgie shape b --approve"
  [ "$status" -eq 0 ]
  [ -f "$P/.bridgie/specs/b/tasks.json" ]
  [[ "$output" == *"the plan stands"* ]]
  run bash -c "cd '$P' && bridgie shape b --amend 'again'"
  [ "$status" -eq 0 ]
  run bash -c "cd '$P' && bridgie shape b --amend 'twice'"
  [ "$status" -ne 0 ]
  [[ "$output" == *"not approved yet"* ]]
}

@test "a revision that drops a requirement the plan's tasks cite says to re-plan" {
  signed_bet "$P" b
  (cd "$P" && bridgie shape b && bridgie shape b --approve && bridgie plan b) >/dev/null 2>&1
  node -e 'const f=process.argv[1],j=require(f); j.tasks[0].requirements.push("R99"); require("fs").writeFileSync(f,JSON.stringify(j,null,2))' "$P/.bridgie/specs/b/tasks.json"
  (cd "$P" && bridgie shape b --amend 'drop it') >/dev/null 2>&1
  run bash -c "cd '$P' && bridgie shape b"
  [ "$status" -eq 0 ]
  [[ "$output" == *"cite R99, which this revision no longer has"* ]]
}

@test "ack answers a pending risk acknowledgement" {
  signed_bet "$P" b
  printf '%s' '{"type":"ack_risk","context":"paths","options":["ack","decline"]}' | node "$BRIDGIE_HOME/runner/state.mjs" decision-add "$P" b - >/dev/null
  run bash -c "cd '$P' && bridgie ack b"
  [ "$status" -eq 0 ]
  [ "$(node "$BRIDGIE_HOME/runner/flow.mjs" ack-recorded "$P" b)" = "true" ]
}

@test "plan warns when a task's requirement names one that a later task builds" {
  signed_bet "$P" b
  (cd "$P" && bridgie shape b && bridgie shape b --approve) >/dev/null 2>&1
  run bash -c "cd '$P' && bridgie plan b"
  [ "$status" -eq 0 ]
  [[ "$output" != *"warning:"* ]]                    # the fixture plan is ordered: P1 and R2 are built together
  # R1 now leans on R2, which T2 builds, and T2 depends on T1
  sed -i.bak 's/record it with status pending\./record it with status pending, de-duplicated as R2 defines./' "$P/.bridgie/specs/b/requirements.md"
  rm -f "$P/.bridgie/specs/b/requirements.md.bak"
  run node "$BRIDGIE_HOME/runner/flow.mjs" plan-warnings "$P" b
  [ "$status" -eq 0 ]
  [[ "$output" == "T1 builds R1, whose text refers to R2, but R2 is built by T2, which depends on T1"* ]]
  [[ "$output" == *"Build R1 and R2 in one task"* ]]
}
