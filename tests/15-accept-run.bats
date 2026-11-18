#!/usr/bin/env bats
load helpers

setup() {
  export BRIDGIE_ADAPTER=fake BRIDGIE_FAKE_SCRIPT="$BRIDGIE_HOME/tests/fixtures/fake-script-implement.sh"
  P="$(make_project --git)"
}

@test "accept is refused while any task has not passed (R6)" {
  planned_bet "$P" b
  run bash -c "cd '$P' && bridgie accept b"
  [ "$status" -ne 0 ]
  [[ "$output" == *"must pass first"* ]]
}

@test "end to end: run stops at design approval, then builds, verifies, packages; accept delivers; learn proposes" {
  signed_bet "$P" b
  run bash -c "cd '$P' && bridgie run b"
  [ "$status" -eq 0 ]
  [[ "$output" == *"approve the design"* ]]
  bash -c "cd '$P' && bridgie shape b --approve" >/dev/null 2>&1
  run bash -c "cd '$P' && bridgie run b"
  [ "$status" -eq 0 ]
  [[ "$output" == *"waiting for your acceptance"* ]]
  [ "$(task_field "$P" b T1 status)" = '"passed"' ]
  [ "$(task_field "$P" b T2 status)" = '"passed"' ]
  [ -f "$P/feature-1.txt" ]
  [ -f "$P/feature-2.txt" ]
  grep -q 'No load test was run' "$P/.bridgie/acceptance/b.md"
  grep -q '| T2 |' "$P/.bridgie/runs/b/packager-01/acceptance-packet.md"
  head="$(git -C "$P" rev-parse bridgie/b)"
  run bash -c "cd '$P' && bridgie accept b --approve"
  [ "$status" -eq 0 ]
  [ "$(fm "$P/.bridgie/acceptance/b.md" decision)" = '"approved"' ]
  [ "$(fm "$P/.bridgie/acceptance/b.md" git_sha)" = "\"$head\"" ]
  [ "$(fm "$P/.bridgie/bets/b/bet.md" status)" = '"delivered"' ]
  run bash -c "cd '$P' && bridgie run b"
  [[ "$output" == *"delivered"* ]]
  run bash -c "cd '$P' && bridgie learn b"
  [ "$status" -eq 0 ]
  grep -q 'status pending' "$P"/.bridgie/learn/proposals-*-b.md
}

@test "a failing review is retried by run and passes on the second attempt" {
  signed_bet "$P" b
  bash -c "cd '$P' && bridgie shape b && bridgie shape b --approve" >/dev/null 2>&1
  D="$(mktemp -d)"; cp "$BRIDGIE_HOME"/adapters/fake/fixtures/*.json "$D"/
  cp "$BRIDGIE_HOME/adapters/fake/fixtures/reviewer-fail.json" "$D/reviewer.1.json"
  run bash -c "cd '$P' && BRIDGIE_FAKE_DIR='$D' bridgie run b"
  [ "$status" -eq 0 ]
  [ "$(task_field "$P" b T1 attempts)" = '2' ]
  [ "$(task_field "$P" b T1 status)" = '"passed"' ]
}

@test "nothing is pushed and the base branch never moves (R7)" {
  R="$(mktemp -d)"; git init -q --bare "$R"
  git -C "$P" remote add origin "$R"; git -C "$P" push -q origin main
  before="$(git -C "$R" for-each-ref)"; main_before="$(git -C "$P" rev-parse main)"
  signed_bet "$P" b
  bash -c "cd '$P' && bridgie run b && bridgie shape b --approve && bridgie run b && bridgie accept b --approve" >/dev/null 2>&1
  [ "$(fm "$P/.bridgie/bets/b/bet.md" status)" = '"delivered"' ]
  [ "$(git -C "$R" for-each-ref)" = "$before" ]
  [ "$(git -C "$P" rev-parse main)" = "$main_before" ]
  ! grep -rnE '^[^#]*git[^#]*[[:space:]]push\b' "$BRIDGIE_HOME/runner" "$BRIDGIE_HOME/bin"
}

@test "money bets need two different approvers" {
  signed_bet "$P" b money
  all_tiers "$P"
  bash -c "cd '$P' && bridgie shape b && bridgie shape b --approve" >/dev/null 2>&1
  run bash -c "cd '$P' && bridgie run b"
  [ "$status" -eq 0 ]
  [[ "$output" == *"waiting for a human ack"* ]]
  bash -c "cd '$P' && bridgie ack b && bridgie run b" >/dev/null 2>&1
  [ -f "$P/.bridgie/acceptance/b.md" ]
  run bash -c "cd '$P' && bridgie accept b --approve"
  [[ "$output" == *"approval 1 of 2"* ]]
  run bash -c "cd '$P' && bridgie accept b --approve"
  [ "$status" -ne 0 ]
  [[ "$output" == *"different approver"* ]]
  run bash -c "cd '$P' && BRIDGIE_USER=second bridgie accept b --conditions 'flag stays off until Monday'"
  [ "$status" -eq 0 ]
  [ "$(fm "$P/.bridgie/acceptance/b.md" decision)" = '"approved_with_conditions"' ]
}

@test "re-planning after packaging makes the old acceptance unusable; accept rebuilds the package" {
  signed_bet "$P" b
  bash -c "cd '$P' && bridgie shape b && bridgie shape b --approve && bridgie run b" >/dev/null 2>&1
  [ "$(fm "$P/.bridgie/acceptance/b.md" decision)" = '"pending"' ]
  bash -c "cd '$P' && bridgie plan b --replan" >/dev/null 2>&1
  [ "$(fm "$P/.bridgie/acceptance/b.md" decision)" = '"superseded"' ]
  run bash -c "cd '$P' && bridgie accept b --approve"
  [ "$status" -ne 0 ]
  [ "$(fm "$P/.bridgie/bets/b/bet.md" status)" = '"signed"' ]
}

@test "approval is refused when the feature branch moved after packaging" {
  signed_bet "$P" b
  bash -c "cd '$P' && bridgie shape b && bridgie shape b --approve && bridgie run b" >/dev/null 2>&1
  git -C "$P" commit -q --allow-empty -m "sneaky change after packaging"
  run bash -c "cd '$P' && bridgie accept b --approve"
  [ "$status" -ne 0 ]
  [[ "$output" == *"stale"* ]]
  [ "$(fm "$P/.bridgie/bets/b/bet.md" status)" = '"signed"' ]
  run bash -c "cd '$P' && bridgie accept b"
  [ "$status" -eq 0 ]
  [[ "$output" == *"stale"* ]]
  run bash -c "cd '$P' && bridgie accept b --approve"
  [ "$status" -eq 0 ]
  [ "$(fm "$P/.bridgie/bets/b/bet.md" status)" = '"delivered"' ]
}
