#!/usr/bin/env bats
load helpers

setup() {
  P="$(make_project --git)"
  bash -c "cd '$P' && bridgie init && bridgie bet new b --title B --risk none" >/dev/null
  node "$BRIDGIE_HOME/runner/state.mjs" bet-transition "$P" b grilling >/dev/null
  printf '%s' '{"type":"question","context":"Who retries today?","options":["yes","no","don'"'"'t know"],"raised_by":{"seat":"grill","run":"grill-1"}}' \
    | node "$BRIDGIE_HOME/runner/state.mjs" decision-add "$P" b - >/dev/null
  node "$BRIDGIE_HOME/runner/state.mjs" bet-transition "$P" b evidence >/dev/null
}

@test "decide answers a question and logs it" {
  run bash -c "cd '$P' && bridgie decide b D1 yes"
  [ "$status" -eq 0 ]
  grep -q 'D1 (question): yes' "$P/.bridgie/bets/b/bet.md"
}

@test "decide with a free-text answer" {
  run bash -c "cd '$P' && bridgie decide b D1 other --text 'finance does it by hand on Fridays'"
  [ "$status" -eq 0 ]
  grep -q 'Fridays' "$P/.bridgie/bets/b/bet.md"
}

@test "don't know creates an evidence task and does not block sign (R14)" {
  bash -c "cd '$P' && bridgie decide b D1 \"don't know\""
  grep -q '\[ \] E1: Who retries today?' "$P/.bridgie/bets/b/bet.md"
  run bash -c "cd '$P' && bridgie sign b"
  [ "$status" -eq 0 ]
  [ "$(fm "$P/.bridgie/bets/b/bet.md" status)" = '"signed"' ]
}

@test "sign is refused while a question is pending" {
  run bash -c "cd '$P' && bridgie sign b"
  [ "$status" -ne 0 ]
  [[ "$output" == *"pending"* ]]
  [ "$(fm "$P/.bridgie/bets/b/bet.md" status)" = '"evidence"' ]
}

@test "sign is refused for a non-owner" {
  bash -c "cd '$P' && bridgie decide b D1 yes"
  run bash -c "cd '$P' && BRIDGIE_USER=intruder bridgie sign b"
  [ "$status" -ne 0 ]
  [[ "$output" == *"owner"* ]]
}

@test "sign --kill kills the bet" {
  bash -c "cd '$P' && bridgie decide b D1 yes"
  run bash -c "cd '$P' && bridgie sign b --kill"
  [ "$status" -eq 0 ]
  [ "$(fm "$P/.bridgie/bets/b/bet.md" status)" = '"killed"' ]
}

@test "sign shorthand and decide produce identical state (P3, CLI half)" {
  bash -c "cd '$P' && bridgie decide b D1 yes && bridgie sign b"
  Q="$(make_project --git)"
  bash -c "cd '$Q' && bridgie init && bridgie bet new b --title B --risk none" >/dev/null
  node "$BRIDGIE_HOME/runner/state.mjs" bet-transition "$Q" b grilling >/dev/null
  printf '%s' '{"type":"question","context":"Who retries today?","options":["yes","no","don'"'"'t know"],"raised_by":{"seat":"grill","run":"grill-1"}}' \
    | node "$BRIDGIE_HOME/runner/state.mjs" decision-add "$Q" b - >/dev/null
  node "$BRIDGIE_HOME/runner/state.mjs" bet-transition "$Q" b evidence >/dev/null
  bash -c "cd '$Q' && bridgie decide b D1 yes"
  id="$(node "$BRIDGIE_HOME/runner/state.mjs" ensure-sign "$Q" b)"
  bash -c "cd '$Q' && bridgie decide b $id sign"
  norm() { sed -E '/^  at: /d; s/"(created_at|decided_at|signed_at)": "[^"]*"/"\1": "T"/g; s/^created: .*/created: X/; s/^signed_at: .*/signed_at: X/; s/^- [0-9-]{10} /- DATE /' "$1"; }
  diff <(norm "$P/.bridgie/decisions/b.json") <(norm "$Q/.bridgie/decisions/b.json")
  diff <(norm "$P/.bridgie/bets/b/bet.md") <(norm "$Q/.bridgie/bets/b/bet.md")
}
