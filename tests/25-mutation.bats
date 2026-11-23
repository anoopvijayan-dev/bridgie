#!/usr/bin/env bats
load helpers

# A data-risk bet: its policy asks for the mutation tier, which runs Bridgie's built-in check with
# the specified tier's command. The fake implementer writes a small module and its tests.
setup() {
  export BRIDGIE_ADAPTER=fake
  P="$(make_project --git)"
  S="$(mktemp -d)/script.sh"
  cat > "$S" <<'SH'
[[ "$1" == "implementer" ]] || exit 0
printf 'export function shipping(total) {\n  if (total >= 100) return 0;\n  return 5;\n}\n' > calc.mjs
if [[ "${BRIDGIE_TEST_CHECK:-weak}" == "strong" ]]; then
  printf "import assert from 'node:assert/strict';\nimport { shipping } from './calc.mjs';\nassert.equal(shipping(100), 0);\nassert.equal(shipping(99), 5);\nassert.equal(shipping(500), 0);\n" > calc.check.mjs
else
  printf "import assert from 'node:assert/strict';\nimport { shipping } from './calc.mjs';\nassert.equal(shipping(500), 0);\n" > calc.check.mjs
fi
SH
  export BRIDGIE_FAKE_SCRIPT="$S"
  signed_bet "$P" b data
  printf "verify:\n  commands:\n    mechanical: ['node -e 0']\n    specified: ['node calc.check.mjs']\n    contracts: ['node -e 0']\n    behavioural: ['node -e 0']\n" >> "$P/.bridgie/policy.yaml"
  policy_changed "$P" b
  (cd "$P" && bridgie shape b && bridgie shape b --approve && bridgie plan b && { bridgie build b || true; } && bridgie ack b) >/dev/null 2>&1   # the first build stops to ask for the risk ack
}
row() { node -e 'const e=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); const r=e.criteria.find(c=>c.tier==="mutation"); console.log(r ? r.result : "none")' "$1"; }

@test "weak tests: the mutation tier fails the task and its log names the changes no test noticed" {
  bash -c "cd '$P' && bridgie build b" >/dev/null 2>&1
  [ "$(task_field "$P" b T1 status)" = '"verify"' ]
  run bash -c "cd '$P' && bridgie verify b"
  [ "$status" -eq 2 ]
  [[ "$output" == *"mutation: "*"bridgie.mjs\" mutate"* ]]
  [ "$(row "$P/.bridgie/runs/b/verify-01/evidence.json")" = "fail" ]
  log="$(ls "$P"/.bridgie/runs/b/verify-01/mutation-*.log)"
  grep -q 'survived  calc.mjs:2  ">=" → ">"' "$log"
  grep -q 'noticed by the tests (25%); 3 survived; the bar is 60%' "$log"
  [ "$(task_field "$P" b T1 status)" = '"failed"' ]
  # the worktree holds the code as the builder left it, not a mutant
  grep -q 'total >= 100' "$P/.bridgie/worktrees/b/T1/calc.mjs"
  [ -z "$(git -C "$P/.bridgie/worktrees/b/T1" status --porcelain)" ]
  # the reviewer was shown the survivors
  grep -q 'survived  calc.mjs:2' "$P/.bridgie/runs/b/reviewer-01/prompt.md"
}

@test "tests at the boundary: every change is noticed, the tier passes and the task merges" {
  bash -c "cd '$P' && BRIDGIE_TEST_CHECK=strong bridgie build b" >/dev/null 2>&1
  run bash -c "cd '$P' && bridgie verify b"
  [ "$status" -eq 0 ]
  [ "$(row "$P/.bridgie/runs/b/verify-01/evidence.json")" = "pass" ]
  grep -q '4 of 4 noticed by the tests (100%)' "$P"/.bridgie/runs/b/verify-01/mutation-*.log
  [ "$(task_field "$P" b T1 status)" = '"passed"' ]
}

@test "policy sets the bar and the number of changes tried" {
  printf 'mutation: { max_mutants: 2, min_score: 0.2 }\n' >> "$P/.bridgie/policy.yaml"
  bash -c "cd '$P' && bridgie build b" >/dev/null 2>&1
  run bash -c "cd '$P' && bridgie verify b"
  log="$(ls "$P"/.bridgie/runs/b/verify-01/mutation-*.log)"
  grep -q 'trying 2 of 4 small changes' "$log"
  grep -q 'the bar is 20%' "$log"
}

@test "a mutant left behind by a killed check is put back before verify commits anything" {
  bash -c "cd '$P' && BRIDGIE_TEST_CHECK=strong bridgie build b" >/dev/null 2>&1
  wt="$P/.bridgie/worktrees/b/T1"
  node -e '
    const fs = require("fs"), cp = require("child_process"), wt = process.argv[1];
    const dir = cp.execFileSync("git", ["-C", wt, "rev-parse", "--absolute-git-dir"], { encoding: "utf8" }).trim();
    const original = fs.readFileSync(wt + "/calc.mjs", "utf8");
    fs.writeFileSync(dir + "/bridgie-mutation.json", JSON.stringify({ file: "calc.mjs", original }));
    fs.writeFileSync(wt + "/calc.mjs", original.replace(">=", ">"));' "$wt"
  run bash -c "cd '$P' && bridgie verify b"
  [ "$status" -eq 0 ]
  [[ "$output" == *"put back calc.mjs: an interrupted mutation check had left it changed"* ]]
  grep -q 'total >= 100' "$P/calc.mjs"                 # what was merged is the builder's code
}

@test "bridgie mutate by hand: needs a base, refuses a bad one, and reports nothing to try on a docs change" {
  Q="$(make_project --git)"
  run bash -c "cd '$Q' && bridgie mutate"
  [ "$status" -ne 0 ]
  [[ "$output" == *"--base <commit or branch>"* ]]
  run bash -c "cd '$Q' && bridgie mutate --base nope"
  [ "$status" -ne 0 ]
  [[ "$output" == *"no such commit: nope"* ]]
  echo "a > b" > "$Q/notes.md"
  run bash -c "cd '$Q' && bridgie mutate --base main --test 'node -e 0'"
  [ "$status" -eq 0 ]
  [[ "$output" == *"nothing to try"* ]]
}
