#!/usr/bin/env bats
load helpers

setup() {
  export BRIDGIE_ADAPTER=fake
  P="$(make_project --git)"
  bash -c "cd '$P' && bridgie init --lane product && bridgie bet new b --title 'Statement packs' --risk money && bridgie grill b && bridgie decide b D1 no && bridgie decide b D2 measured" >/dev/null 2>&1
  node "$BRIDGIE_HOME/runner/state.mjs" fm-set "$P/.bridgie/bets/b/bet.md" confidence '"data"' --schema bet
}

@test "numbers: template, computed verdict, and the sign gate for money bets" {
  run bash -c "cd '$P' && bridgie sign b"
  [ "$status" -ne 0 ]
  [[ "$output" == *"requires unit economics"* ]]
  run bash -c "cd '$P' && bridgie numbers b"
  [ "$status" -ne 0 ]
  [[ "$output" == *"--template"* ]]
  run bash -c "cd '$P' && bridgie numbers b --template"
  [ "$status" -eq 0 ]
  [ -f "$P/.bridgie/bets/b/numbers.yaml" ]
  run bash -c "cd '$P' && bridgie numbers b"
  [ "$status" -eq 0 ]
  [[ "$output" == *"profitable on these inputs"* ]]
  grep -q '"verdict": "profitable"' "$P/.bridgie/bets/b/numbers.json"
  grep -q '## Year 1 by month' "$P/.bridgie/bets/b/numbers.md"
  run bash -c "cd '$P' && bridgie sign b"
  [ "$status" -eq 0 ]
  [ "$(fm "$P/.bridgie/bets/b/bet.md" status)" = '"signed"' ]
}

@test "numbers: a unit that loses money is 'not yet' and still blocks signing" {
  bash -c "cd '$P' && bridgie numbers b --template" >/dev/null
  node -e 'const f=process.argv[1];const fs=require("fs");fs.writeFileSync(f,fs.readFileSync(f,"utf8").replace(/^variable_cost: .*$/m,"variable_cost: 50"))' "$P/.bridgie/bets/b/numbers.yaml"
  run bash -c "cd '$P' && bridgie numbers b"
  [ "$status" -eq 0 ]
  [[ "$output" == *"not yet"* ]] && [[ "$output" == *"unit_positive"* ]]
  run bash -c "cd '$P' && bridgie sign b"
  [ "$status" -ne 0 ]
  [[ "$output" == *"loses money"* ]]
}

@test "evidence: plan mode needs a section per open task; synthesis mode raises a confidence decision the owner accepts" {
  Q="$(make_project --git)"
  bash -c "cd '$Q' && bridgie init --lane product && bridgie bet new e --title 'Packs' && bridgie grill e && bridgie decide e D1 \"don't know\"" >/dev/null 2>&1
  grep -q '\[ \] E1:' "$Q/.bridgie/bets/e/bet.md"
  run bash -c "cd '$Q' && bridgie evidence e"
  [ "$status" -eq 0 ]
  [[ "$output" == *"evidence plan for 1 task(s)"* ]]
  grep -q '### E1' "$Q/.bridgie/bets/e/evidence-plan.md"
  grep -q 'When did you last' "$Q/.bridgie/bets/e/evidence-plan.md"
  # a plan that skips an open task is rejected
  printf '{"seat":"evidence","summary_md":"s","artifact_md":"### E9\\nMethod: x"}' > "$Q/bad.json"
  run bash -c "cd '$Q' && BRIDGIE_FAKE_OUTPUT='$Q/bad.json' bridgie evidence e"
  [ "$status" -ne 0 ]
  [[ "$output" == *"output rejected"* ]]
  # synthesis: the owner drops notes beside the bet; the second fixture proposes anecdote
  mkdir -p "$Q/.bridgie/bets/e/evidence"; for i in 1 2 3; do echo "Broker $i: about half a day per pack" > "$Q/.bridgie/bets/e/evidence/notes-broker-$i.md"; done
  run bash -c "cd '$Q' && BRIDGIE_FAKE_OUTPUT='$BRIDGIE_HOME/tests/fixtures/fake/evidence.2.json' bridgie evidence e"
  [ "$status" -eq 0 ]
  [[ "$output" == *"confidence proposal raised as D"* ]]
  grep -q 'notes-broker-2.md' "$Q/.bridgie/runs/e/evidence-03/prompt.md"
  [ "$(fm "$Q/.bridgie/bets/e/bet.md" confidence)" = '"opinion"' ]
  id="$(node "$BRIDGIE_HOME/runner/flow.mjs" pending-of-type "$Q" e confidence)"
  run bash -c "cd '$Q' && bridgie decide e $id 'accept anecdote'"
  [ "$status" -eq 0 ]
  [ "$(fm "$Q/.bridgie/bets/e/bet.md" confidence)" = '"anecdote"' ]
}

@test "evidence is refused with nothing to do, and after signing" {
  Q="$(make_project --git)"
  bash -c "cd '$Q' && bridgie init --lane product && bridgie bet new e" >/dev/null 2>&1
  run bash -c "cd '$Q' && bridgie evidence e"
  [ "$status" -ne 0 ]
  [[ "$output" == *"no open evidence tasks"* ]]
  signed_bet "$Q" s
  run bash -c "cd '$Q' && bridgie evidence s"
  [ "$status" -ne 0 ]
  [[ "$output" == *"decide loop is closed"* ]]
}
