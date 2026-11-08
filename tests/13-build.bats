#!/usr/bin/env bats
load helpers

setup() {
  export BRIDGIE_ADAPTER=fake BRIDGIE_FAKE_SCRIPT="$BRIDGIE_HOME/tests/fixtures/fake-script-implement.sh"
  P="$(make_project --git)"
}

@test "build launches exactly one implementer for the first ready task in a fresh worktree (R2)" {
  planned_bet "$P" b
  run bash -c "cd '$P' && bridgie build b"
  [ "$status" -eq 0 ]
  [ "$(ls -d "$P"/.bridgie/runs/b/implementer-* | wc -l)" -eq 1 ]
  wt="$P/.bridgie/worktrees/b/T1"
  [ -f "$wt/feature-1.txt" ]
  [ "$(git -C "$wt" branch --show-current)" = "bridgie-task/b/T1" ]
  [ -z "$(git -C "$wt" status --porcelain)" ]
  node -e 'process.exit(require("fs").readFileSync(process.argv[1], "utf8").replace(/\\/g, "/").includes(".bridgie/worktrees/b/T1") ? 0 : 1)' "$P/.bridgie/runs/b/implementer-01/prompt.md"
  node -e 'const i=require(process.argv[1]).inputs; const allowed=["task","requirements","design","evidence","gotchas","agents_md"]; if(!i.every(x=>allowed.includes(x))) process.exit(1)' "$P/.bridgie/runs/b/implementer-01/inputs.json"
  [ "$(task_field "$P" b T1 status)" = '"verify"' ]
  [ "$(task_field "$P" b T1 attempts)" = '1' ]
  [ "$(task_field "$P" b T2 status)" = '"todo"' ]
  grep -q '"task": "T1"' "$P/.bridgie/runs/b/implementer-01/claim.json"
  [ ! -f "$P/feature-1.txt" ]
}

@test "build refuses tasks whose dependencies have not passed" {
  planned_bet "$P" b
  run bash -c "cd '$P' && bridgie build b --task T2"
  [ "$status" -ne 0 ]
  [[ "$output" == *"not ready"* ]]
}

@test "an implementer that edits .bridgie/ in its worktree fails the attempt and is discarded" {
  planned_bet "$P" b
  printf '[[ "$1" == implementer ]] || exit 0\nmkdir -p .bridgie/specs/b && echo "{}" > .bridgie/specs/b/tasks.json\necho code > sneaky.txt\n' > "$P/evil.sh"
  run bash -c "cd '$P' && BRIDGIE_FAKE_SCRIPT='$P/evil.sh' bridgie build b"
  [ "$status" -ne 0 ]
  [[ "$output" == *"edited .bridgie/"* ]]
  [ ! -f "$P/.bridgie/worktrees/b/T1/sneaky.txt" ]
  [ "$(task_field "$P" b T1 status)" = '"failed"' ]
  [ -f "$P/.bridgie/runs/b/implementer-01/VIOLATION" ]
}

@test "an adapter failure counts as a failed attempt" {
  planned_bet "$P" b
  run bash -c "cd '$P' && BRIDGIE_FAKE_EXIT=9 bridgie build b"
  [ "$status" -ne 0 ]
  [ "$(task_field "$P" b T1 status)" = '"failed"' ]
  [[ "$(task_field "$P" b T1 escalation)" == *"implementer run failed"* ]]
}

@test "money risk needs a human ack before build (R9), then runs the hardener too" {
  planned_bet "$P" b money
  run bash -c "cd '$P' && bridgie build b"
  [ "$status" -ne 0 ]
  [[ "$output" == *"waiting for a human ack"* ]]
  grep -q '"type": "ack_risk"' "$P/.bridgie/decisions/b.json"
  run bash -c "cd '$P' && bridgie ack b && bridgie build b"
  [ "$status" -eq 0 ]
  [ -d "$P/.bridgie/runs/b/hardener-01" ]
  [ -f "$P/.bridgie/runs/b/hardener-01/diff.patch" ]
}

@test "build must run on the feature branch" {
  planned_bet "$P" b
  git -C "$P" checkout -q main
  run bash -c "cd '$P' && bridgie build b"
  [ "$status" -ne 0 ]
  [[ "$output" == *"bridgie/b"* ]]
}
