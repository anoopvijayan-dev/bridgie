#!/usr/bin/env bats
load helpers

setup() {
  export BRIDGIE_ADAPTER=fake
  P="$(make_project --git)"
  bash -c "cd '$P' && bridgie init && bridgie bet new b --title 'UNIQUE-BET-TITLE' --risk none" >/dev/null
  mkdir -p "$P/.bridgie/specs/b"; echo 'DECOY-DESIGN-MARKER' > "$P/.bridgie/specs/b/design.md"
}

@test "seat-run creates a run dir with prompt, output, cost and only declared inputs (P2)" {
  run bash -c "cd '$P' && bridgie seat-run b decide/grill"
  [ "$status" -eq 0 ]
  dir="$output"
  [ -f "$dir/prompt.md" ] && [ -f "$dir/seat-output.json" ] && [ -f "$dir/cost.json" ] && [ -f "$dir/inputs.json" ]
  grep -q 'UNIQUE-BET-TITLE' "$dir/prompt.md"
  ! grep -q 'DECOY-DESIGN-MARKER' "$dir/prompt.md"
  grep -q '"inputs": \[' "$dir/inputs.json"
}

@test "second run of the same seat gets the next number" {
  bash -c "cd '$P' && bridgie seat-run b decide/grill" >/dev/null
  run bash -c "cd '$P' && bridgie seat-run b decide/grill"
  [[ "$output" == *"/grill-02" ]]
}

@test "a seat that writes state directly fails the run and state is restored (P1)" {
  before="$(cat "$P/.bridgie/decisions/b.json")"
  run bash -c "cd '$P' && BRIDGIE_FAKE_MISBEHAVE=1 bridgie seat-run b decide/grill"
  [ "$status" -ne 0 ]
  [[ "$output" == *"state restored"* ]]
  [ "$(cat "$P/.bridgie/decisions/b.json")" = "$before" ]
  [ -f "$P/.bridgie/runs/b/grill-01/VIOLATION" ]
}

@test "adapter failure is reported with the log path" {
  run bash -c "cd '$P' && BRIDGIE_FAKE_EXIT=7 bridgie seat-run b decide/grill"
  [ "$status" -ne 0 ]
  [[ "$output" == *"exited 7"* ]]
}

@test "invalid seat output is rejected" {
  echo '{"nope":true}' > "$P/bad.json"
  run bash -c "cd '$P' && BRIDGIE_FAKE_OUTPUT='$P/bad.json' bridgie seat-run b decide/grill"
  [ "$status" -ne 0 ]
  [[ "$output" == *"does not match"* ]]
}

@test "unknown seat and mechanical seat are refused" {
  run bash -c "cd '$P' && bridgie seat-run b decide/nope"
  [ "$status" -ne 0 ]
  run bash -c "cd '$P' && BRIDGIE_ADAPTER= bridgie seat-run b verify/mechanical"
  [ "$status" -ne 0 ]
  [[ "$output" == *"mechanical"* ]]
}

@test "a seat that deletes a state file is caught and the file is restored (P1)" {
  before="$(cat "$P/.bridgie/decisions/b.json")"
  printf 'rm -f .bridgie/decisions/b.json\n' > "$P/.git/del.sh"
  run bash -c "cd '$P' && BRIDGIE_FAKE_SCRIPT='$P/.git/del.sh' bridgie seat-run b decide/grill"
  [ "$status" -ne 0 ]
  [[ "$output" == *"state restored"* ]]
  [ "$(cat "$P/.bridgie/decisions/b.json")" = "$before" ]
  grep -q '"removed":\[".bridgie/decisions/b.json"\]' "$P/.bridgie/runs/b/grill-01/VIOLATION"
}

@test "state files a seat creates are removed, and policy and other bets are guarded too (P1)" {
  printf 'echo planted > .bridgie/learn/planted.md\necho "x: 1" >> .bridgie/policy.yaml\nmkdir -p .bridgie/bets/other && echo hi > .bridgie/bets/other/bet.md\n' > "$P/.git/plant.sh"
  policy="$(cat "$P/.bridgie/policy.yaml")"
  run bash -c "cd '$P' && BRIDGIE_FAKE_SCRIPT='$P/.git/plant.sh' bridgie seat-run b decide/grill"
  [ "$status" -ne 0 ]
  [ ! -e "$P/.bridgie/learn/planted.md" ]
  [ ! -e "$P/.bridgie/bets/other/bet.md" ]
  [ "$(cat "$P/.bridgie/policy.yaml")" = "$policy" ]
}

@test "a human change during an agent run is refused with a clear message, not rolled back as tampering" {
  printf 'bridgie bet new other > "$0.log" 2>&1 || echo refused > "$0.refused"\n' > "$P/.git/human.sh"
  sed -i "s|\$0|$P/.git/human|g" "$P/.git/human.sh"
  run bash -c "cd '$P' && BRIDGIE_FAKE_SCRIPT='$P/.git/human.sh' bridgie seat-run b decide/grill"
  [ "$status" -eq 0 ]
  [ -f "$P/.git/human.refused" ]
  grep -q 'an agent run is in progress' "$P/.git/human.log"
  [ ! -e "$P/.bridgie/bets/other" ]
  [ ! -f "$P/.bridgie/runs/b/grill-01/VIOLATION" ]
  run bash -c "cd '$P' && bridgie bet new other"
  [ "$status" -eq 0 ]
}

@test "the seat lock is released after success and after failure; a live lock refuses a second run" {
  bash -c "cd '$P' && bridgie seat-run b decide/grill" >/dev/null
  [ ! -d "$P/.bridgie/.seat-lock" ]
  bash -c "cd '$P' && BRIDGIE_FAKE_EXIT=1 bridgie seat-run b decide/grill" >/dev/null 2>&1 || true
  [ ! -d "$P/.bridgie/.seat-lock" ]
  mkdir "$P/.bridgie/.seat-lock"
  printf '{"seat":"implementer","run_dir":"x","since":"%s","pid":1}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$P/.bridgie/.seat-lock/owner.json"
  run bash -c "cd '$P' && bridgie seat-run b decide/grill"
  [ "$status" -ne 0 ]
  [[ "$output" == *"another agent run is in progress"* ]]
  printf '{"seat":"implementer","run_dir":"x","since":"2020-01-01T00:00:00Z","pid":1}\n' > "$P/.bridgie/.seat-lock/owner.json"
  run bash -c "cd '$P' && bridgie seat-run b decide/grill"
  [ "$status" -eq 0 ]
}
