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

@test "re-plan: refused while tasks have progress; --replan archives task branches and supersedes their decisions" {
  planned_bet "$P" b
  run bash -c "cd '$P' && bridgie plan b"
  [ "$status" -eq 0 ]                                       # nothing started yet: a plain re-plan is fine
  (cd "$P" && bridgie build b) >/dev/null 2>&1
  [ "$(task_field "$P" b T1 status)" = '"verify"' ]
  run bash -c "cd '$P' && bridgie plan b"
  [ "$status" -ne 0 ]
  [[ "$output" == *"already has task progress"* ]]
  [[ "$output" == *"--replan"* ]]
  run bash -c "cd '$P' && bridgie plan b --replan"
  echo "$output"
  [ "$status" -eq 0 ]
  [[ "$output" == *"archived under bridgie-task-archive/b/"* ]]
  [ "$(task_field "$P" b T1 status)" = '"todo"' ]
  [ "$(task_field "$P" b T1 attempts)" = '0' ]
  ! git -C "$P" rev-parse -q --verify "refs/heads/bridgie-task/b/T1" >/dev/null
  git -C "$P" for-each-ref --format='%(refname:short)' 'refs/heads/bridgie-task-archive/b/' | grep -q '/T1$'
  [ ! -d "$P/.bridgie/worktrees/b/T1" ]
}

@test "a task a killed run left in progress is recovered by build, and the dead attempt is not counted" {
  planned_bet "$P" b
  # what a run killed mid-build leaves: the task in_progress and a seat lock whose process is gone
  node "$BRIDGIE_HOME/runner/flow.mjs" start-attempt "$P" b T1 bridgie-task/b/T1 >/dev/null
  mkdir "$P/.bridgie/.seat-lock"
  printf '{"seat":"implementer","run_dir":"x","since":"%s","pid":4194999}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$P/.bridgie/.seat-lock/owner.json"
  [ "$(task_field "$P" b T1 status)" = '"in_progress"' ]
  run bash -c "cd '$P' && bridgie build b"
  [ "$status" -eq 0 ]
  [[ "$output" == *"recovered T1"* ]]
  [ "$(task_field "$P" b T1 status)" = '"verify"' ]
  [ "$(task_field "$P" b T1 attempts)" = '1' ]
}

@test "recover clears a dead run's lock and its task; a live run is left alone" {
  planned_bet "$P" b
  node "$BRIDGIE_HOME/runner/flow.mjs" start-attempt "$P" b T1 bridgie-task/b/T1 >/dev/null
  mkdir "$P/.bridgie/.seat-lock"
  printf '{"seat":"implementer","run_dir":"x","since":"%s","pid":%s}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$$" > "$P/.bridgie/.seat-lock/owner.json"
  run bash -c "cd '$P' && bridgie recover b"
  [ "$status" -ne 0 ]
  [[ "$output" == *"in progress"* ]]
  [ "$(task_field "$P" b T1 status)" = '"in_progress"' ]
  printf '{"seat":"implementer","run_dir":"x","since":"%s","pid":4194999}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$P/.bridgie/.seat-lock/owner.json"
  run bash -c "cd '$P' && bridgie recover b"
  [ "$status" -eq 0 ]
  [[ "$output" == *"recovered T1"* ]]
  [ ! -d "$P/.bridgie/.seat-lock" ]
  [ "$(task_field "$P" b T1 status)" = '"todo"' ]
  [ "$(task_field "$P" b T1 attempts)" = '0' ]
}
