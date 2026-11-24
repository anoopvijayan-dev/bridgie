#!/usr/bin/env bats
load helpers

setup() {
  export BRIDGIE_ADAPTER=fake BRIDGIE_FAKE_SCRIPT="$BRIDGIE_HOME/tests/fixtures/fake-script-implement.sh"
  P="$(make_project --git)"
  D="$(mktemp -d)"; cp "$BRIDGIE_HOME"/adapters/fake/fixtures/*.json "$D"/
  export BRIDGIE_FAKE_DIR="$D"
}

living() {   # living <project>: a living spec with one earlier requirement, as if a bet "old" was accepted
  mkdir -p "$1/.bridgie/spec"
  printf '# Living spec\n\n## old.R1 · event · risk: none\nWHEN a refund is made THE SYSTEM SHALL record it.\nSource: old (2026-11-01)\n\n## old.R2 · ubiquitous · risk: none\nTHE SYSTEM SHALL show refunds.\nSource: old (2026-11-01)\n' > "$1/.bridgie/spec/requirements.md"
}
shaper_with() {   # shaper_with <extra requirements text>: the fake shaper's requirements gain this text
  node -e 'const f=process.argv[1];const o=JSON.parse(require("fs").readFileSync(f,"utf8"));o.files["requirements.md"]+=process.argv[2];require("fs").writeFileSync(f,JSON.stringify(o))' "$D/shaper.json" "$1"
}
drift_finding() {   # the spec-checker reports one major finding on old.R1
  printf '{"seat":"spec-checker","summary_md":"one","findings":[{"requirement":"old.R1","severity":"major","claim":"refunds are no longer recorded","file":"feature-1.txt","line":1}]}' > "$D/spec-checker.json"
}
to_accept() {   # a signed bet b → shaped → approved → built and verified, ready to package
  (cd "$P" && bridgie shape b && bridgie shape b --approve && bridgie plan b && bridgie build b && bridgie verify b && bridgie build b && bridgie verify b) >/dev/null 2>&1
}

@test "the first accepted bet starts the living spec, and the package lists what it added" {
  signed_bet "$P" b; to_accept
  run bash -c "cd '$P' && bridgie accept b"
  [ "$status" -eq 0 ]
  grep -q '^## b.R1 · event · risk: none' "$P/.bridgie/spec/requirements.md"
  grep -q '^Source: b (' "$P/.bridgie/spec/requirements.md"
  grep -q '^## Spec changes' "$P/.bridgie/acceptance/b.md"
  grep -q 'b.R2' "$P/.bridgie/acceptance/b.md"
  [ ! -d "$P/.bridgie/runs/b/spec-checker-01" ]   # nothing earlier to check
}

@test "shape rejects a Changes line that names no living requirement" {
  signed_bet "$P" b; living "$P"; shaper_with $'\n## R3 · event · risk: none\nChanges: old.R9\nTHE SYSTEM SHALL x.\n'
  run bash -c "cd '$P' && bridgie shape b"
  [ "$status" -ne 0 ]
  [[ "$output" == *"names no requirement in the living spec"* ]]
}

@test "a bet that changes and removes living requirements: the merged spec keeps ids, drops removals, and repackaging does not apply it twice" {
  signed_bet "$P" b; living "$P"; shaper_with $'\n## Removed\n- old.R2: replaced by R1.\n'
  node -e 'const f=process.argv[1];const o=JSON.parse(require("fs").readFileSync(f,"utf8"));o.files["requirements.md"]=o.files["requirements.md"].replace("## R1 · event · risk: none\n","## R1 · event · risk: none\nChanges: old.R1\n");require("fs").writeFileSync(f,JSON.stringify(o))' "$D/shaper.json"
  to_accept
  run bash -c "cd '$P' && bridgie accept b"
  [ "$status" -eq 0 ]
  L="$P/.bridgie/spec/requirements.md"
  grep -q '^## old.R1' "$L"
  grep -q '^Changed by: b (' "$L"
  ! grep -q '^## old.R2' "$L"
  grep -q '^## b.R2' "$L"
  grep -q 'old.R2: replaced by R1.' "$P/.bridgie/acceptance/b.md"
  cp "$L" "$BATS_TEST_TMPDIR/once"
  bash -c "cd '$P' && bridgie accept b --reject 'again' && bridgie accept b" >/dev/null 2>&1
  cmp -s "$L" "$BATS_TEST_TMPDIR/once"
  [ "$(fm "$P/.bridgie/acceptance/b.md" decision)" = '"pending"' ]
}

@test "a drift finding waits for the owner; still holds needs a reason and lets the package through" {
  signed_bet "$P" b; living "$P"; drift_finding; to_accept
  run bash -c "cd '$P' && bridgie accept b"
  [ "$status" -eq 3 ]
  [[ "$output" == *"spec drift"* ]]
  [ ! -f "$P/.bridgie/acceptance/b.md" ]
  id="$(node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).decisions.find(x=>x.type==="spec_drift"&&x.status==="pending");console.log(d.id)' "$P/.bridgie/decisions/b.json")"
  run bash -c "cd '$P' && bridgie decide b $id 'still holds'"
  [ "$status" -ne 0 ]
  [[ "$output" == *"reason"* ]]
  bash -c "cd '$P' && bridgie decide b $id 'still holds' --text 'refunds are recorded by the ledger'" >/dev/null 2>&1
  run bash -c "cd '$P' && bridgie accept b"
  [ "$status" -eq 0 ]
  [ "$(ls -d "$P"/.bridgie/runs/b/spec-checker-* | wc -l | tr -d ' ')" = 1 ]   # the result was reused
  grep -q '^## Spec drift' "$P/.bridgie/acceptance/b.md"
  grep -q 'refunds are recorded by the ledger' "$P/.bridgie/acceptance/b.md"
}

@test "amend the design re-opens the design with the finding" {
  signed_bet "$P" b; living "$P"; drift_finding; to_accept
  bash -c "cd '$P' && bridgie accept b" >/dev/null 2>&1 || true
  id="$(node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).decisions.find(x=>x.type==="spec_drift"&&x.status==="pending");console.log(d.id)' "$P/.bridgie/decisions/b.json")"
  run bash -c "cd '$P' && bridgie decide b $id 'amend the design'"
  [ "$status" -eq 0 ]
  [ "$(node "$BRIDGIE_HOME/runner/flow.mjs" design-approved "$P" b)" = false ]
  grep -q 'refunds are no longer recorded' "$P/.bridgie/decisions/b.json"
}

@test "a spec-checker at its usage limit makes accept wait, with nothing changed" {
  signed_bet "$P" b; living "$P"; to_accept
  node -e 'const f=process.argv[1];const s={};s.fake={exhausted_until:new Date(Date.now()+3600e3).toISOString(),why:"test"};require("fs").writeFileSync(f,JSON.stringify(s))' "$P/.bridgie/.adapter-state.json"
  run bash -c "cd '$P' && bridgie accept b"
  [ "$status" -eq 3 ]
  [[ "$output" == *"waiting"* ]]
  [ ! -f "$P/.bridgie/acceptance/b.md" ]
}

@test "drift_check off skips the check; turning it off after signing is governance drift" {
  signed_bet "$P" b
  printf 'living_spec: { drift_check: false }\n' >> "$P/.bridgie/policy.yaml"
  run node "$BRIDGIE_HOME/runner/flow.mjs" governance-gate "$P" b
  [[ "$output" == D* ]]
  policy_changed "$P" b
  living "$P"; drift_finding; to_accept
  run bash -c "cd '$P' && bridgie accept b"
  [ "$status" -eq 0 ]
  [ ! -d "$P/.bridgie/runs/b/spec-checker-01" ]
  ! grep -q '^## Spec drift' "$P/.bridgie/acceptance/b.md"
}

@test "accept warns when the base branch changed a requirement this bet changes" {
  signed_bet "$P" b; living "$P"
  git -C "$P" add .bridgie/spec && git -C "$P" commit -q -m "living spec on main"
  node -e 'const f=process.argv[1];const o=JSON.parse(require("fs").readFileSync(f,"utf8"));o.files["requirements.md"]=o.files["requirements.md"].replace("## R1 · event · risk: none\n","## R1 · event · risk: none\nChanges: old.R1\n");require("fs").writeFileSync(f,JSON.stringify(o))' "$D/shaper.json"
  to_accept
  W="$(mktemp -d)/main"; git -C "$P" worktree add -q "$W" main
  sed -i.bak 's/record it\./record it with its reason./' "$W/.bridgie/spec/requirements.md" && rm -f "$W/.bridgie/spec/requirements.md.bak"
  git -C "$W" commit -q -am "another bet changed old.R1"; git -C "$P" worktree remove --force "$W"
  run bash -c "cd '$P' && bridgie accept b"
  [ "$status" -eq 0 ]
  [[ "$output" == *"old.R1 changed on main since this bet was shaped"* ]]
  grep -q 'old.R1 changed on main' "$P/.bridgie/acceptance/b.md"
}

@test "the package goes stale when the living spec is edited after packaging" {
  signed_bet "$P" b; to_accept
  bash -c "cd '$P' && bridgie accept b" >/dev/null 2>&1
  echo "edited" >> "$P/.bridgie/spec/requirements.md"
  run bash -c "cd '$P' && bridgie accept b --approve"
  [ "$status" -ne 0 ]
  [[ "$output" == *"stale"* ]]
}
