#!/usr/bin/env bats
load helpers

setup() {
  export BRIDGIE_ADAPTER=fake BRIDGIE_FAKE_SCRIPT="$BRIDGIE_HOME/tests/fixtures/fake-script-implement.sh"
  P="$(make_project --git)"
  planned_bet "$P" b
  (cd "$P" && bridgie build b) >/dev/null 2>&1
  [ "$(task_field "$P" b T1 status)" = '"verify"' ]
}

@test "pass: evidence for every requirement, merged into the feature branch only" {
  run bash -c "cd '$P' && bridgie verify b"
  [ "$status" -eq 0 ]
  [[ "$output" == *"T1: pass"* ]]
  [ "$(task_field "$P" b T1 status)" = '"passed"' ]
  [ -f "$P/feature-1.txt" ]
  ! git -C "$P" show main:feature-1.txt 2>/dev/null
  [ ! -d "$P/.bridgie/worktrees/b/T1" ]
  [ ! -d "$P/.bridgie/worktrees/b/T1-review" ]
  grep -q '"verdict": "pass"' "$P/.bridgie/runs/b/verify-01/evidence.json"
  grep -q 'feature-1.txt' "$P/.bridgie/runs/b/verify-01/diff.patch"
  grep -q 'feature-1.txt' "$P/.bridgie/runs/b/reviewer-01/diff.patch"
}

@test "the diff packet never contains .bridgie run files (R8)" {
  run bash -c "cd '$P' && bridgie verify b"
  ! grep -q '\.bridgie/' "$P/.bridgie/runs/b/verify-01/diff.patch"
}

@test "a reviewer that touches its worktree fails the run (R3)" {
  printf '[[ "$1" == reviewer ]] && echo hacked > hacked.txt\nexit 0\n' > "$P/.git/rv.sh"
  run bash -c "cd '$P' && BRIDGIE_FAKE_SCRIPT='$P/.git/rv.sh' bridgie verify b"
  [ "$status" -ne 0 ]
  [[ "$output" == *"modified its read-only worktree"* ]]
  [ "$(task_field "$P" b T1 status)" = '"verify"' ]
  [ ! -d "$P/.bridgie/worktrees/b/T1-review" ]
}

@test "a missing evidence row is not_proven and fails the task (R4)" {
  printf '{"task":"T1","criteria":[],"findings":[],"verdict":"pass","verifier":{"seat":"reviewer","adapter":"fake","model":"m"}}' > "$P/.git/empty.json"
  run bash -c "cd '$P' && BRIDGIE_FAKE_OUTPUT='$P/.git/empty.json' bridgie verify b"
  [ "$status" -ne 0 ]
  [ "$(task_field "$P" b T1 status)" = '"failed"' ]
  grep -q '"result": "not_proven"' "$P/.bridgie/runs/b/verify-01/evidence.json"
}

@test "fail, then retry gets the findings, then blocked after max attempts with an unblock decision (R5)" {
  F="$BRIDGIE_HOME/tests/fixtures/fake/reviewer-fail.json"
  run bash -c "cd '$P' && BRIDGIE_FAKE_OUTPUT='$F' bridgie verify b"
  [ "$status" -ne 0 ]
  [ "$(task_field "$P" b T1 status)" = '"failed"' ]
  bash -c "cd '$P' && bridgie build b" >/dev/null 2>&1
  grep -q 'collection created without a status' "$P/.bridgie/runs/b/implementer-02/prompt.md"
  bash -c "cd '$P' && BRIDGIE_FAKE_OUTPUT='$F' bridgie verify b" >/dev/null 2>&1 || true
  bash -c "cd '$P' && bridgie build b && BRIDGIE_FAKE_OUTPUT='$F' bridgie verify b" >/dev/null 2>&1 || true
  [ "$(task_field "$P" b T1 status)" = '"blocked"' ]
  grep -q '"type": "unblock"' "$P/.bridgie/decisions/b.json"
  run bash -c "cd '$P' && bridgie build b"
  [ "$status" -ne 0 ]
}

@test "touching a risk path asks for a human ack before verification (R9)" {
  printf 'version: 1\nlanes:\n  engineering:\n    risk_paths:\n      - { glob: "feature-*.txt", risk: security }\n' > "$P/.bridgie/policy.yaml"
  all_tiers "$P"
  run bash -c "cd '$P' && bridgie verify b"
  [ "$status" -ne 0 ]
  [[ "$output" == *"risk raised to security"* ]]
  [[ "$output" == *"waiting for a human ack"* ]]
  [ "$(fm "$P/.bridgie/bets/b/bet.md" risk)" = '"security"' ]
  grep -q 'risk none → security: task T1 changes feature-1.txt (security)' "$P/.bridgie/bets/b/bet.md"
  run bash -c "cd '$P' && bridgie ack b && bridgie verify b"
  [ "$status" -eq 0 ]
  grep -q 'behavioural' "$P/.bridgie/runs/b/verify-02/evidence.json"
}

@test "a required tier with no command is not_proven and the task cannot pass" {
  printf 'version: 1\nverify:\n  commands:\n    mechanical: ["node -e 0"]\n' > "$P/.bridgie/policy.yaml"
  run bash -c "cd '$P' && bridgie verify b"
  [ "$status" -ne 0 ]
  [[ "$output" == *"specified: no command configured"* ]]
  [ "$(task_field "$P" b T1 status)" = '"failed"' ]
  grep -q 'no command configured for required tier specified' "$P/.bridgie/runs/b/verify-01/evidence.json"
}

@test "the reviewer gets the runner's test results and logs (it cannot run commands)" {
  printf 'version: 1\nverify:\n  commands:\n    mechanical: ["echo built-ok"]\n    specified: ["echo 7 tests passed"]\n' > "$P/.bridgie/policy.yaml"
  bash -c "cd '$P' && bridgie verify b" >/dev/null 2>&1
  grep -q 'test results (runner-run, read-only)' "$P/.bridgie/runs/b/reviewer-01/prompt.md"
  grep -q '7 tests passed' "$P/.bridgie/runs/b/reviewer-01/prompt.md"
}

@test "a reviewer that cannot read the repository is refused (R10)" {
  run bash -c "cd '$P' && BRIDGIE_FAKE_READS_REPO=0 bridgie verify b"
  [ "$status" -ne 0 ]
  [[ "$output" == *"packet-only review is refused"* ]]
  [ ! -d "$P/.bridgie/runs/b/reviewer-01" ]
}

@test "same vendor for producer and reviewer is refused when cross_family is on (R11)" {
  Q="$(make_project --git)"; planned_bet "$Q" b
  (cd "$Q" && BRIDGIE_FAKE_SAME_VENDOR=1 bridgie build b) >/dev/null 2>&1
  run bash -c "cd '$Q' && BRIDGIE_FAKE_SAME_VENDOR=1 bridgie verify b"
  [ "$status" -ne 0 ]
  [[ "$output" == *"different model family"* ]]
}

@test "mechanical commands from policy run in the worktree and a failure fails the task" {
  printf 'version: 1\nverify:\n  commands:\n    mechanical: ["test -f feature-1.txt", "test -f missing.txt"]\n' > "$P/.bridgie/policy.yaml"
  run bash -c "cd '$P' && bridgie verify b"
  [ "$status" -ne 0 ]
  grep -q '"id": "mechanical:1"' "$P/.bridgie/runs/b/verify-01/evidence.json"
  node -e 'const e=require(process.argv[1]); const r=Object.fromEntries(e.criteria.map(c=>[c.id,c.result])); if(r["mechanical:1"]!=="pass"||r["mechanical:2"]!=="fail") process.exit(1)' "$P/.bridgie/runs/b/verify-01/evidence.json"
}
