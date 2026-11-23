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
  policy_changed "$P" b
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

delivered_package() {       # a risk-none bet built, verified and packaged, waiting for acceptance
  signed_bet "$P" b
  bash -c "cd '$P' && bridgie run b && bridgie shape b --approve && bridgie run b" >/dev/null 2>&1
  [ -f "$P/.bridgie/acceptance/b.md" ]
}

@test "inside an agent, accepting needs --relayed, and the record says the answer came through the agent" {
  delivered_package
  run bash -c "cd '$P' && BRIDGIE_HARNESS=claude-code bridgie accept b --approve"
  [ "$status" -ne 0 ]
  [[ "$output" == *"is for a person"* ]]
  [[ "$output" == *"--relayed"* ]]
  [ "$(fm "$P/.bridgie/acceptance/b.md" decision)" = '"pending"' ]
  run bash -c "cd '$P' && BRIDGIE_HARNESS=claude-code bridgie accept b --approve --relayed"
  [ "$status" -eq 0 ]
  [ "$(fm "$P/.bridgie/acceptance/b.md" decision)" = '"approved"' ]
  node -e '
    const d = require(process.argv[1]).decisions.find(x => x.type === "accept");
    process.exit(d.via && d.via.agent === "claude-code" && d.via.relayed === true && d.via.channel === "cli" ? 0 : 1)' "$P/.bridgie/decisions/b.json"
  grep -q 'approve → approved; bet delivered.* \[tester through claude-code (relayed)\]' "$P/.bridgie/bets/b/bet.md"
}

@test "with relay off an agent cannot accept at all; a person's terminal can" {
  delivered_package
  printf 'humans_only: { decisions: [accept, governance], relay: false }\n' >> "$P/.bridgie/policy.yaml"   # stricter: not drift
  run bash -c "cd '$P' && BRIDGIE_HARNESS=codex bridgie accept b --approve --relayed"
  [ "$status" -ne 0 ]
  [[ "$output" == *"own terminal"* ]]
  run bash -c "cd '$P' && bridgie accept b --approve"
  [ "$status" -eq 0 ]
  node -e '
    const d = require(process.argv[1]).decisions.find(x => x.type === "accept");
    process.exit(d.via && d.via.agent === null ? 0 : 1)' "$P/.bridgie/decisions/b.json"
}

@test "a policy made weaker after signing stops build until the owner decides (governance lock)" {
  planned_bet "$P" b
  printf 'lanes:\n  engineering:\n    cross_family: false\n' >> "$P/.bridgie/policy.yaml"
  run bash -c "cd '$P' && bridgie build b"
  [ "$status" -eq 3 ]
  [[ "$output" == *"policy is weaker than the rules 'b' was signed under"* ]]
  [[ "$output" == *"another model family is no longer required"* ]]
  [ "$(task_field "$P" b T1 status)" = '"todo"' ]
  D="$(node -e 'const d=require(process.argv[1]).decisions.find(x=>x.type==="governance"); console.log(d.id)' "$P/.bridgie/decisions/b.json")"
  # run stops on it too, and raises no second decision
  run bash -c "cd '$P' && bridgie run b"
  [ "$(node -e 'console.log(require(process.argv[1]).decisions.filter(x=>x.type==="governance").length)' "$P/.bridgie/decisions/b.json")" = "1" ]
  [ "$(task_field "$P" b T1 status)" = '"todo"' ]
  # an agent cannot wave its own policy change through
  run bash -c "cd '$P' && BRIDGIE_HARNESS=claude-code bridgie decide b $D 'accept the change'"
  [ "$status" -ne 0 ]
  [[ "$output" == *"is for a person"* ]]
  # keeping the signed rules: still stopped, until the policy file goes back
  bash -c "cd '$P' && bridgie decide b $D 'keep the signed rules'" >/dev/null 2>&1
  run bash -c "cd '$P' && bridgie build b"
  [ "$status" -eq 3 ]
  [[ "$output" == *"put .bridgie/policy.yaml back"* ]]
  sed -i.bak '/^lanes:$/,$d' "$P/.bridgie/policy.yaml"
  run bash -c "cd '$P' && bridgie build b"
  [ "$status" -eq 0 ]
}

@test "the owner accepting a policy change moves the bet to the new rules" {
  planned_bet "$P" b
  printf 'lanes:\n  engineering:\n    cross_family: false\n' >> "$P/.bridgie/policy.yaml"
  run bash -c "cd '$P' && bridgie build b"
  [ "$status" -eq 3 ]
  D="$(node -e 'const d=require(process.argv[1]).decisions.find(x=>x.type==="governance"); console.log(d.id)' "$P/.bridgie/decisions/b.json")"
  run bash -c "cd '$P' && BRIDGIE_USER=someone-else bridgie decide b $D 'accept the change'"
  [ "$status" -ne 0 ]
  [[ "$output" == *"only the owner"* ]]
  run bash -c "cd '$P' && bridgie decide b $D 'accept the change'"
  [ "$status" -eq 0 ]
  run bash -c "cd '$P' && bridgie build b"
  [ "$status" -eq 0 ]
  grep -q 'accept the change → the bet is now held to the current policy \[tester\]' "$P/.bridgie/bets/b/bet.md"
}

@test "owner override delivers a money bet with one approval, and the acceptance record says so" {
  signed_bet "$P" b money
  all_tiers "$P"
  policy_changed "$P" b
  bash -c "cd '$P' && bridgie shape b && bridgie shape b --approve && bridgie run b; bridgie ack b && bridgie run b" >/dev/null 2>&1
  [ -f "$P/.bridgie/acceptance/b.md" ]
  run bash -c "cd '$P' && BRIDGIE_USER=second bridgie accept b --override 'no time'"
  [ "$status" -ne 0 ]
  [[ "$output" == *"only the owner"* ]]
  run bash -c "cd '$P' && bridgie accept b --override ''"
  [ "$status" -ne 0 ]
  run bash -c "cd '$P' && bridgie accept b --override 'solo founder: there is no second approver'"
  [ "$status" -eq 0 ]
  [[ "$output" == *"approved by owner override with 1 of 2 approvals"* ]]
  [ "$(fm "$P/.bridgie/acceptance/b.md" decision)" = '"approved"' ]
  [ "$(fm "$P/.bridgie/acceptance/b.md" override | node -e 'const o=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log(o.by, o.approvals, o.required)')" = "tester 1 2" ]
  [ "$(fm "$P/.bridgie/bets/b/bet.md" status)" = '"delivered"' ]
}

@test "run --pause-before-verify stops after each build; running it again verifies that task and builds the next" {
  planned_bet "$P" b
  run bash -c "cd '$P' && bridgie run b --pause-before-verify"
  [ "$status" -eq 0 ]
  [[ "$output" == *"paused before verify: T1 is built on bridgie-task/b/T1"* ]]
  [ "$(task_field "$P" b T1 status)" = '"verify"' ]
  [ "$(task_field "$P" b T2 status)" = '"todo"' ]
  run bash -c "cd '$P' && bridgie run b --pause-before-verify"
  [ "$status" -eq 0 ]
  [[ "$output" == *"paused before verify: T2 is built"* ]]
  [ "$(task_field "$P" b T1 status)" = '"passed"' ]
  [ "$(task_field "$P" b T2 status)" = '"verify"' ]
  run bash -c "cd '$P' && bridgie run b --pause-before-verify"
  [ "$status" -eq 0 ]
  [[ "$output" == *"waiting for your acceptance"* ]] || [ -f "$P/.bridgie/acceptance/b.md" ]
  [ "$(task_field "$P" b T2 status)" = '"passed"' ]
}

@test "status --cost shows where the time went, task by task" {
  planned_bet "$P" b
  run bash -c "cd '$P' && bridgie status --cost b"
  [ "$status" -eq 0 ]
  bash -c "cd '$P' && bridgie run b" >/dev/null 2>&1
  run bash -c "cd '$P' && bridgie status --cost b"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Task"*"Attempts"*"Build"*"Review"*"Checks"*"Total"* ]]
  [[ "$output" == *"T1"*"passed"* ]]
  [[ "$output" == *"(bet)"* ]]
  [[ "$output" == *"of agent and check time"* ]]
  # every run of a task is counted on its row: builder, tiers and reviewer
  node -e '
    const fl = require("node:child_process").execFileSync("node", [process.argv[1] + "/runner/flow.mjs", "cost-by-task", process.argv[2], "b"], { encoding: "utf8" });
    const t1 = JSON.parse(fl).find(r => r.task === "T1");
    process.exit(t1.runs >= 3 ? 0 : 1)' "$BRIDGIE_HOME" "$P"
  run bash -c "cd '$P' && bridgie status --cost nope"
  [ "$status" -ne 0 ]
}

@test "what the model CLIs report (tokens, cost) reaches the cost view and the acceptance package" {
  export BRIDGIE_FAKE_USAGE='{"tokens_in":100,"tokens_out":900,"tokens_cache_read":9000,"tokens_total":10000,"usd":0.25}'
  planned_bet "$P" b
  bash -c "cd '$P' && bridgie run b" >/dev/null 2>&1
  [ -f "$P/.bridgie/acceptance/b.md" ]
  run bash -c "cd '$P' && bridgie status --cost b"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Tokens"*"Cost"* ]]
  [[ "$output" == *"per passed task, everything included"* ]]
  [[ "$output" == *"on a subscription it is not a bill"* ]]
  [[ "$output" != *"reported no usage"* ]]
  node -e '
    const e = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).entries[0];
    process.exit(e.tokens_total === 10000 && e.usd === 0.25 && e.tokens_cache_read === 9000 && e.task === "T1" ? 0 : 1)' "$P/.bridgie/runs/b/implementer-01/cost.json"
  grep -q 'tokens\. \$[0-9.]* at list price' "$P/.bridgie/runs/b/packager-01/acceptance-packet.md"
  # the stored acceptance record carries the totals
  node "$BRIDGIE_HOME/runner/state.mjs" fm-get "$P/.bridgie/acceptance/b.md" cost | node -e 'const c=JSON.parse(require("fs").readFileSync(0,"utf8")); process.exit(c.usd > 0 && c.tokens > 0 ? 0 : 1)'
}
