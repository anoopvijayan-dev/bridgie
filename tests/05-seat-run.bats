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
