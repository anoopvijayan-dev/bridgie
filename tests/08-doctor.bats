#!/usr/bin/env bats
load helpers

@test "doctor passes on the tool repo outside a project" {
  cd "$(mktemp -d)"
  run bridgie doctor
  [ "$status" -eq 0 ]
  [[ "$output" == *"[ok]"*"seats valid"* ]]
  [[ "$output" == *"[warn] not inside a project"* ]]
  [[ "$output" == *"adapter fake: probe OK"* ]]
}

@test "doctor checks a project's state and AGENTS.md links" {
  P="$(make_project --git)"
  bash -c "cd '$P' && bridgie init && bridgie bet new b" >/dev/null
  printf '# Map\n\n- [docs](docs/README.md)\n' > "$P/AGENTS.md"
  run bash -c "cd '$P' && bridgie doctor"
  [ "$status" -ne 0 ]
  [[ "$output" == *"[fail] AGENTS.md link does not resolve: docs/README.md"* ]]
  mkdir -p "$P/docs" && echo x > "$P/docs/README.md"
  run bash -c "cd '$P' && bridgie doctor"
  [ "$status" -eq 0 ]
  [[ "$output" == *"1 bet(s) checked"* ]]
}

@test "doctor fails on a broken seat manifest" {
  H="$(mktemp -d)"
  for d in bin runner schemas policy templates ui adapters seats lanes; do cp -r "$BRIDGIE_HOME/$d" "$H/"; done
  cp "$BRIDGIE_HOME/VERSION" "$H/"
  printf -- '---\nname: grill\nloop: decide\ntier: bogus\ninputs: [bet]\nwrites: run_dir\ntools: []\noutput: seat-output.json\n---\n## Role\n' > "$H/seats/decide/grill/SKILL.md"
  cd "$(mktemp -d)"
  run env BRIDGIE_HOME="$H" "$H/bin/bridgie" doctor
  [ "$status" -ne 0 ]
  [[ "$output" == *"[fail] seat decide/grill"* ]]
}
