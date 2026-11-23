#!/usr/bin/env bats
load helpers

setup() {
  export BRIDGIE_ADAPTER=fake
  P="$(make_project --git)"
  # the fake implementer writes down what the runner asked of it
  S="$(mktemp -d)/script.sh"
  printf '[[ "$1" == "implementer" ]] || exit 0\necho "built" > "feature-$2.txt"\nprintf "%%s|%%s" "$BRIDGIE_SANDBOX" "$BRIDGIE_SANDBOX_NETWORK" > "$(git rev-parse --git-common-dir)/asked"\n' > "$S"
  export BRIDGIE_FAKE_SCRIPT="$S"
}
sandbox_of() { node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).entries.at(-1).sandbox)' "$P/.bridgie/runs/b/$1/cost.json"; }

@test "by default a seat that writes is asked to sandbox itself, with the policy's hosts; the run records that it was" {
  planned_bet "$P" b
  run bash -c "cd '$P' && bridgie build b"
  [ "$status" -eq 0 ]
  [[ "$output" != *"without an OS sandbox"* ]]
  [ "$(cat "$P/.git/asked")" = "auto|registry.npmjs.org,pypi.org,files.pythonhosted.org,api.nuget.org" ]
  [ "$(sandbox_of implementer-01)" = "builtin" ]
  # a read-only seat is not a build seat: nothing is asked and nothing recorded
  bash -c "cd '$P' && bridgie verify b" >/dev/null 2>&1
  [ "$(sandbox_of reviewer-01)" = "undefined" ]
}

@test "auto: an adapter with no sandbox still builds, with a warning, and the run records that it was not sandboxed" {
  planned_bet "$P" b
  run bash -c "cd '$P' && BRIDGIE_FAKE_SANDBOX=none bridgie build b"
  [ "$status" -eq 0 ]
  [[ "$output" == *"warning: seat implementer runs without an OS sandbox (adapter fake has none); set sandbox.build: required to refuse that"* ]]
  [ "$(sandbox_of implementer-01)" = "none" ]
  [ "$(task_field "$P" b T1 status)" = '"verify"' ]
}

@test "required: nothing is built without a sandbox, and the attempt is not used" {
  signed_bet "$P" b
  printf 'sandbox: { build: required, network: [example.org] }\n' >> "$P/.bridgie/policy.yaml"
  policy_changed "$P" b
  (cd "$P" && bridgie shape b && bridgie shape b --approve && bridgie plan b) >/dev/null 2>&1
  run bash -c "cd '$P' && BRIDGIE_FAKE_SANDBOX=none bridgie build b"
  [ "$status" -eq 3 ]
  [[ "$output" == *"policy requires an OS sandbox for seats that write (sandbox.build: required), and adapter 'fake' has none on this machine"* ]]
  [ "$(task_field "$P" b T1 status)" = '"todo"' ]
  [ "$(task_field "$P" b T1 attempts)" = "0" ]
  [ ! -e "$P/.git/asked" ]
  # with a sandbox it builds, and is told the policy's own hosts
  run bash -c "cd '$P' && bridgie build b"
  [ "$status" -eq 0 ]
  [ "$(cat "$P/.git/asked")" = "required|example.org" ]
}

@test "off: nothing is asked, and the run records it" {
  signed_bet "$P" b
  printf 'sandbox: { build: off }\n' >> "$P/.bridgie/policy.yaml"
  (cd "$P" && bridgie shape b && bridgie shape b --approve && bridgie plan b) >/dev/null 2>&1
  run bash -c "cd '$P' && bridgie build b"
  [ "$status" -eq 3 ]                                # weaker than the bet was signed under
  [[ "$output" == *"the sandbox for build seats went from auto to off"* ]]
  policy_changed "$P" b
  run bash -c "cd '$P' && bridgie build b"
  [ "$status" -eq 0 ]
  [ "$(cut -d'|' -f1 "$P/.git/asked")" = "off" ]
  [ "$(sandbox_of implementer-01)" = "off" ]
}

@test "the acceptance package says how many of the runs that wrote code were sandboxed" {
  planned_bet "$P" b
  bash -c "cd '$P' && BRIDGIE_FAKE_SANDBOX=none bridgie build b && bridgie verify b && bridgie run b" >/dev/null 2>&1
  [ -f "$P/.bridgie/acceptance/b.md" ]
  grep -q '## Isolation' "$P/.bridgie/runs/b/packager-01/acceptance-packet.md"
  grep -q '1 of 2 runs that wrote code ran in a sandbox.*; 1 ran with the full access of the account that started Bridgie' "$P/.bridgie/runs/b/packager-01/acceptance-packet.md"
}
