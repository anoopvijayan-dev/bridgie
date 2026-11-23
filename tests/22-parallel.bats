#!/usr/bin/env bats
load helpers

# Two independent tasks (T1, T2) and one that needs both (T3).
setup() {
  export BRIDGIE_ADAPTER=fake BRIDGIE_FAKE_SCRIPT="$BRIDGIE_HOME/tests/fixtures/fake-script-parallel.sh"
  P="$(make_project --git)"
  signed_bet "$P" b
  (cd "$P" && bridgie shape b && bridgie shape b --approve && BRIDGIE_FAKE_OUTPUT="$BRIDGIE_HOME/tests/fixtures/decomposer-parallel.json" bridgie plan b) >/dev/null 2>&1
  [ -f "$P/.bridgie/specs/b/tasks.json" ]
}
body() { tr -d '\r' < "$1"; }   # git may check files out with CRLF (Windows, core.autocrlf)
statuses() { node -e 'console.log(require(process.argv[1]).tasks.map(t=>`${t.id}:${t.status}:${t.attempts}`).join(" "))' "$P/.bridgie/specs/b/tasks.json"; }

@test "build --parallel builds independent tasks together, each on its own branch, and never one that waits on them" {
  run bash -c "cd '$P' && BRIDGIE_TEST_SLEEP=1 bridgie build b --parallel 4"
  [ "$status" -eq 0 ]
  [[ "$output" == *"building 2 independent tasks together: T1, T2"* ]]
  [[ "$output" == *"built T1, T2"* ]]
  [ "$(statuses)" = "T1:verify:1 T2:verify:1 T3:todo:0" ]
  [ "$(git -C "$P" show bridgie-task/b/T1:feature-T1.txt)" = "built by T1" ]
  [ "$(git -C "$P" show bridgie-task/b/T2:feature-T2.txt)" = "built by T2" ]
  run git -C "$P" show bridgie-task/b/T1:feature-T2.txt
  [ "$status" -ne 0 ]                                # each task has only its own change
  [ ! -e "$P/.bridgie/.seat-lock" ]
  [ -z "$(find "$P/.bridgie/runs/b" -name VIOLATION)" ]
  [ -d "$P/.bridgie/runs/b/implementer-01" ] && [ -d "$P/.bridgie/runs/b/implementer-02" ]
  # they really ran at the same time: both started before either finished
  node -e '
    const fs = require("fs"), d = process.argv[1];
    const e = ["implementer-01", "implementer-02"].map(r => JSON.parse(fs.readFileSync(`${d}/${r}/cost.json`, "utf8")).entries[0]);
    const s = e.map(x => Date.parse(x.started_at)), f = e.map((x, i) => s[i] + x.duration_s * 1000);
    process.exit(Math.max(...s) < Math.min(...f) && new Set(e.map(x => x.task)).size === 2 ? 0 : 1)' "$P/.bridgie/runs/b"
}

@test "the default is one task at a time, and policy build.parallel sets the width" {
  run bash -c "cd '$P' && bridgie build b"
  [ "$status" -eq 0 ]
  [ "$(statuses)" = "T1:verify:1 T2:todo:0 T3:todo:0" ]
  printf 'build: { parallel: 2 }\n' >> "$P/.bridgie/policy.yaml"
  bash -c "cd '$P' && bridgie verify b" >/dev/null 2>&1
  run bash -c "cd '$P' && bridgie build b"
  [ "$status" -eq 0 ]
  [ "$(statuses)" = "T1:passed:1 T2:verify:1 T3:todo:0" ]   # only T2 is ready: T3 waits on it
  run bash -c "cd '$P' && bridgie build b --parallel 0"
  [ "$status" -ne 0 ]
  [[ "$output" == *"whole number from 1 to 16"* ]]
}

@test "run --parallel: tasks built together are verified one at a time, the later ones brought up to date first" {
  run bash -c "cd '$P' && bridgie run b --parallel 2"
  [ "$status" -eq 0 ]
  [[ "$output" == *"building 2 independent tasks together: T1, T2"* ]]
  [[ "$output" == *"T2: brought up to date with bridgie/b"* ]]
  [ "$(statuses)" = "T1:passed:1 T2:passed:1 T3:passed:1" ]
  for t in T1 T2 T3; do [ "$(body "$P/feature-$t.txt")" = "built by $t" ]; done
  [ -f "$P/.bridgie/acceptance/b.md" ]
  # T2 was verified with T1's code present: its tiers ran on the merged tree
  git -C "$P" log --format=%s bridgie/b | grep -q 'bridgie: sync T2 with bridgie/b'
  [ "$(git -C "$P" branch --show-current)" = "bridgie/b" ]
  [ -z "$(git -C "$P" status --porcelain --untracked-files=no)" ]
}

@test "two tasks that wrote the same file: the second goes back to build with the conflict named, and is rebuilt on top" {
  export BRIDGIE_TEST_MODE=shared
  bash -c "cd '$P' && bridgie build b --parallel 2" >/dev/null 2>&1
  [ "$(statuses)" = "T1:verify:1 T2:verify:1 T3:todo:0" ]
  bash -c "cd '$P' && bridgie verify b" >/dev/null 2>&1
  run bash -c "cd '$P' && bridgie verify b"
  [ "$status" -eq 2 ]
  [[ "$output" == *"T2 conflicts with what was merged since it was built (shared.txt); it goes back to build"* ]]
  [ "$(statuses)" = "T1:passed:1 T2:failed:1 T3:todo:0" ]
  [[ "$(task_field "$P" b T2 escalation)" == *'git merge bridgie/b'* ]]
  [ -z "$(git -C "$P/.bridgie/worktrees/b/T2" status --porcelain)" ]              # the failed merge was undone
  [ -z "$(git -C "$P" status --porcelain --untracked-files=no)" ]
  [ "$(body "$P/shared.txt")" = "built by T1" ]
  run bash -c "cd '$P' && bridgie run b"
  [ "$status" -eq 0 ]
  [ "$(statuses)" = "T1:passed:1 T2:passed:2 T3:passed:1" ]
  grep -q 'built by T1' "$P/shared.txt" && grep -q 'built by T2' "$P/shared.txt"   # both tasks' work is kept
}

@test "one task of a batch failing does not sink the others" {
  run bash -c "cd '$P' && BRIDGIE_TEST_MODE=state bridgie build b --parallel 2"
  [ "$status" -eq 0 ]
  [[ "$output" == *"T2: build: implementer edited .bridgie/ in the worktree"* ]]
  [[ "$output" == *"built T1; T2 did not finish"* ]]
  [ "$(statuses)" = "T1:verify:1 T2:failed:1 T3:todo:0" ]
  [ ! -e "$P/.bridgie/.seat-lock" ]
}

@test "a seat that edits project state during a parallel build is still caught and the state restored" {
  before="$(body "$P/.bridgie/policy.yaml")"
  run bash -c "cd '$P' && BRIDGIE_TEST_MODE=tamper bridgie build b --parallel 2"
  [ "$status" -ne 0 ]
  [[ "$output" == *"a seat wrote to Bridgie state files while T1, T2 were built together"* ]]
  [ "$(body "$P/.bridgie/policy.yaml")" = "$before" ]
  # the runner cannot tell which seat did it: nothing the batch built is kept
  [ "$(statuses)" = "T1:failed:1 T2:failed:1 T3:todo:0" ]
  run git -C "$P" show bridgie-task/b/T1:feature-T1.txt
  [ "$status" -ne 0 ]
  run git -C "$P" show bridgie-task/b/T2:feature-T2.txt
  [ "$status" -ne 0 ]
  [ -n "$(find "$P/.bridgie/runs/b" -name VIOLATION)" ]
  [ ! -e "$P/.bridgie/.seat-lock" ]
}

@test "tasks that declare the same files are not built together" {
  node -e '
    const fs = require("fs"), f = process.argv[1], d = JSON.parse(fs.readFileSync(f, "utf8"));
    d.tasks[0].touches = ["src/pay/**"]; d.tasks[1].touches = ["src/pay/refund.py"];
    fs.writeFileSync(f, JSON.stringify(d, null, 2) + "\n")' "$P/.bridgie/specs/b/tasks.json"
  run bash -c "cd '$P' && bridgie build b --parallel 2"
  [ "$status" -eq 0 ]
  [[ "$output" == *"T2 waits for the next batch: it touches the same files as T1"* ]]
  [ "$(statuses)" = "T1:verify:1 T2:todo:0 T3:todo:0" ]
}

@test "a killed parallel build is recovered: every task it had started is buildable again, uncounted" {
  node "$BRIDGIE_HOME/runner/flow.mjs" start-attempt "$P" b T1 bridgie-task/b/T1 >/dev/null
  node "$BRIDGIE_HOME/runner/flow.mjs" start-attempt "$P" b T2 bridgie-task/b/T2 >/dev/null
  mkdir -p "$P/.bridgie/.seat-lock"
  printf '{"seat":"build","run_dir":".bridgie/runs/b","since":"2026-01-01T00:00:00Z","pid":999999,"host":"%s"}\n' "$(hostname)" > "$P/.bridgie/.seat-lock/owner.json"
  run bash -c "cd '$P' && bridgie build b --parallel 2"
  [ "$status" -eq 0 ]
  [[ "$output" == *"recovered T1, T2"* ]]
  [ "$(statuses)" = "T1:verify:1 T2:verify:1 T3:todo:0" ]
}
