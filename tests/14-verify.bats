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

@test "a task built on another machine verifies after its branch is fetched (worktree re-created)" {
  R="$(mktemp -d)/origin.git"; git init -q --bare "$R"
  git -C "$P" push -q "$R" "bridgie-task/b/T1"
  git -C "$P" worktree remove --force "$P/.bridgie/worktrees/b/T1"
  git -C "$P" branch -q -D "bridgie-task/b/T1"
  run bash -c "cd '$P' && bridgie verify b"
  [ "$status" -ne 0 ]
  [[ "$output" == *"no worktree or branch for T1"* ]]
  git -C "$P" remote add other "$R" && git -C "$P" fetch -q other
  run bash -c "cd '$P' && bridgie verify b"
  echo "$output"
  [ "$status" -eq 0 ]
  [[ "$output" == *"T1: pass"* ]]
  [ -f "$P/feature-1.txt" ]
}

@test "the runner records the review's task and verifier itself, whatever the reviewer wrote there" {
  printf '{"criteria":[],"findings":[],"verdict":"pass","verifier":"reviewer-01"}' > "$P/.git/noself.json"
  run bash -c "cd '$P' && BRIDGIE_FAKE_OUTPUT='$P/.git/noself.json' bridgie verify b"
  [[ "$output" != *"does not match schemas/evidence.json"* ]]
  grep -q '"task": "T1"' "$P/.bridgie/runs/b/reviewer-01/evidence.json"
  grep -q '"adapter": "fake"' "$P/.bridgie/runs/b/reviewer-01/evidence.json"
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
  F="$BRIDGIE_HOME/adapters/fake/fixtures/reviewer-fail.json"
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
  # each row points at the full log, so a named test can be confirmed beyond the 60-line tail
  log="$(grep -o 'Full log: [^ ]*' "$P/.bridgie/runs/b/reviewer-01/prompt.md" | sed -n 2p | cut -d' ' -f3)"
  [ -f "$log" ]
  grep -q '7 tests passed' "$log"
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

@test "a verify retried for the same commit reuses the tier results instead of running them again" {
  # the tier command counts its own runs; the reviewer's output is malformed the first time
  sed -i.bak "s|    mechanical: \['node -e 0'\]|    mechanical: ['echo run >> \"$P/.git/tier-runs\"']|" "$P/.bridgie/policy.yaml"
  printf 'not json' > "$P/.git/bad.json"
  run bash -c "cd '$P' && BRIDGIE_FAKE_OUTPUT='$P/.git/bad.json' bridgie verify b"
  [ "$status" -ne 0 ]
  [ "$(task_field "$P" b T1 status)" = '"verify"' ]
  [ "$(wc -l < "$P/.git/tier-runs")" -eq 1 ]
  run bash -c "cd '$P' && bridgie verify b"
  echo "$output"
  [ "$status" -eq 0 ]
  [[ "$output" == *"reusing the results of verify-01 for the same commit"* ]]
  [ "$(wc -l < "$P/.git/tier-runs")" -eq 1 ]
  [ "$(task_field "$P" b T1 status)" = '"passed"' ]
}

blocked_by_review() {   # three reviews that fail on a finding, every tier passing
  F="$BRIDGIE_HOME/adapters/fake/fixtures/reviewer-fail.json"
  bash -c "cd '$P' && BRIDGIE_FAKE_OUTPUT='$F' bridgie verify b" >/dev/null 2>&1 || true
  bash -c "cd '$P' && bridgie build b && BRIDGIE_FAKE_OUTPUT='$F' bridgie verify b" >/dev/null 2>&1 || true
  bash -c "cd '$P' && bridgie build b && BRIDGIE_FAKE_OUTPUT='$F' bridgie verify b" >/dev/null 2>&1 || true
  [ "$(task_field "$P" b T1 status)" = '"blocked"' ]
}

@test "a task blocked by review findings can be accepted with them as known limitations, then merges without a new review" {
  blocked_by_review
  D="$(node -e 'const d=require(process.argv[1]).decisions.find(x=>x.type==="unblock"&&x.status!=="answered"); console.log(d.id)' "$P/.bridgie/decisions/b.json")"
  grep -q 'accept as limitations' "$P/.bridgie/decisions/b.json"
  run bash -c "cd '$P' && bridgie decide b $D 'accept as limitations'"
  [ "$status" -ne 0 ]
  [[ "$output" == *"needs the reason"* ]]
  run bash -c "cd '$P' && bridgie decide b $D 'accept as limitations' --text 'acceptable for the pilot'"
  echo "$output"
  [ "$status" -eq 0 ]
  [ "$(task_field "$P" b T1 status)" = '"verify"' ]
  reviews="$(ls -d "$P"/.bridgie/runs/b/reviewer-* | wc -l)"
  run bash -c "cd '$P' && bridgie verify b"
  echo "$output"
  [ "$status" -eq 0 ]
  [[ "$output" == *"pass with 1 accepted limitation(s)"* ]]
  [ "$(task_field "$P" b T1 status)" = '"passed"' ]
  [ -f "$P/feature-1.txt" ]
  [ "$(ls -d "$P"/.bridgie/runs/b/reviewer-* | wc -l)" -eq "$reviews" ]          # no new review
  grep -q '"accepted_limitations"' "$(node -e 'console.log(require(process.argv[1]).tasks[0].evidence)' "$P/.bridgie/specs/b/tasks.json")"
  grep -q '"verdict": "fail"' "$(node -e 'console.log(require(process.argv[1]).tasks[0].evidence)' "$P/.bridgie/specs/b/tasks.json")"   # the reviewer's verdict is kept
  # the next task's reviewer is told
  bash -c "cd '$P' && bridgie build b && bridgie verify b" >/dev/null 2>&1
  grep -q 'known limitations the owner accepted' "$(ls -d "$P"/.bridgie/runs/b/reviewer-* | tail -1)/prompt.md"
  grep -q 'acceptable for the pilot' "$(ls -d "$P"/.bridgie/runs/b/reviewer-* | tail -1)/prompt.md"
}

@test "accepted limitations do not survive a changed commit: the task is reviewed again" {
  blocked_by_review
  D="$(node -e 'const d=require(process.argv[1]).decisions.find(x=>x.type==="unblock"&&x.status!=="answered"); console.log(d.id)' "$P/.bridgie/decisions/b.json")"
  bash -c "cd '$P' && bridgie decide b $D 'accept as limitations' --text 'ok'" >/dev/null 2>&1
  echo changed > "$P/.bridgie/worktrees/b/T1/extra.txt"
  run bash -c "cd '$P' && bridgie verify b"
  echo "$output"
  [[ "$output" == *"so it is reviewed again"* ]]
  [ "$status" -eq 0 ]                                # the default reviewer fixture passes
  [[ "$output" != *"accepted limitation(s)"* ]]
}

@test "a same-family review is recorded as review debt, shown in status, and cleared by rereview" {
  printf 'lanes:\n  engineering:\n    cross_family: false\n' >> "$P/.bridgie/policy.yaml"
  sed -i.bak 's/fake-producer/fake/' "$P/.bridgie/runs/b/implementer-01/adapter.json"   # the producer was the same family
  run bash -c "cd '$P' && BRIDGIE_FAKE_SAME_VENDOR=1 bridgie verify b"
  echo "$output"
  [ "$status" -eq 0 ]
  [[ "$output" == *"the producer's own model family"* ]]
  node -e 'const t=require(process.argv[1]).tasks[0]; process.exit(t.review && t.review.cross_family === false ? 0 : 1)' "$P/.bridgie/specs/b/tasks.json"
  sed -i.bak '/^lanes:$/,$d' "$P/.bridgie/policy.yaml"; all_tiers "$P" 2>/dev/null || true
  run bash -c "cd '$P' && bridgie status"
  [[ "$output" == *"review debt on 1 task(s)"* ]]
  run bash -c "cd '$P' && bridgie rereview b"
  echo "$output"
  [ "$status" -eq 0 ]
  [[ "$output" == *"T1: pass by fake"* ]]
  [[ "$output" == *"Review debt left: none"* ]]
  [ "$(task_field "$P" b T1 status)" = '"passed"' ]
  run bash -c "cd '$P' && bridgie status"
  [[ "$output" != *"review debt"* ]]
  grep -q 'second review of task T1' "$(ls -d "$P"/.bridgie/runs/b/reviewer-* | tail -1)/prompt.md"
}
