#!/usr/bin/env bats
load helpers

FAKE() { "$BRIDGIE_HOME/adapters/fake/run.sh" "$@"; }

@test "fake capabilities: producer vs verifier vendors, overrides" {
  run FAKE --capabilities --seat "$BRIDGIE_HOME/seats/build/implementer"
  [ "$output" = '{"vendor":"fake-producer","reads_repo":true}' ]
  run FAKE --capabilities --seat "$BRIDGIE_HOME/seats/verify/reviewer"
  [ "$output" = '{"vendor":"fake-verifier","reads_repo":true}' ]
  BRIDGIE_FAKE_SAME_VENDOR=1 BRIDGIE_FAKE_READS_REPO=0 run FAKE --capabilities --seat "$BRIDGIE_HOME/seats/verify/reviewer"
  [ "$output" = '{"vendor":"fake","reads_repo":false}' ]
}

@test "fake returns the n-th fixture per seat, then falls back" {
  d="$(mktemp -d)"; mkdir -p "$d/fx" "$d/.bridgie/runs/b/x"
  echo '{"n":1}' > "$d/fx/grill.1.json"; echo '{"n":"default"}' > "$d/fx/grill.json"; echo p > "$d/p.md"
  for i in 1 2; do BRIDGIE_FAKE_DIR="$d/fx" FAKE --seat "$BRIDGIE_HOME/seats/decide/grill" --prompt "$d/p.md" --out "$d/.bridgie/runs/b/x/o$i.json" --cwd "$d" --mode readonly --model m >/dev/null; done
  [ "$(cat "$d/.bridgie/runs/b/x/o1.json")" = '{"n":1}' ]
  [ "$(cat "$d/.bridgie/runs/b/x/o2.json")" = '{"n":"default"}' ]
}

@test "stdout mode goes through JSON extraction and a seat run still validates" {
  export BRIDGIE_ADAPTER=fake BRIDGIE_FAKE_STDOUT=1
  P="$(make_project --git)"
  bash -c "cd '$P' && bridgie init && bridgie bet new b" >/dev/null
  run bash -c "cd '$P' && bridgie seat-run b decide/grill"
  [ "$status" -eq 0 ]
  [ -f "$output/reply.txt" ]
  grep -q '"seat": "grill"' "$output/seat-output.json"
  grep -q '"vendor":"fake-producer"' "$output/adapter.json"
}

@test "fake script runs inside the working directory" {
  d="$(mktemp -d)"; mkdir -p "$d/.bridgie/runs/b/x"; echo p > "$d/p.md"
  printf 'echo "$1 $2" > touched.txt\n' > "$d/s.sh"
  BRIDGIE_FAKE_SCRIPT="$d/s.sh" FAKE --seat "$BRIDGIE_HOME/seats/decide/grill" --prompt "$d/p.md" --out "$d/.bridgie/runs/b/x/o.json" --cwd "$d" --mode write --model m >/dev/null
  [ "$(cat "$d/touched.txt")" = "grill 1" ]
}
