#!/usr/bin/env bats
load helpers

# A copy of Bridgie with one extra adapter, "broken": it probes OK but its CLI fails every run
# (exit 6 = signed out / crashed, or BROKEN_EXIT). The project routes every tier to it.
setup() {
  unset BRIDGIE_ADAPTER
  C="$(mktemp -d)/bridgie"; mkdir -p "$C"
  for d in bin runner schemas policy templates ui adapters seats lanes skills; do cp -r "$BRIDGIE_HOME/$d" "$C/"; done
  cp "$BRIDGIE_HOME/VERSION" "$C/"
  mkdir -p "$C/adapters/broken"
  cat > "$C/adapters/broken/run.mjs" <<'EOF'
const a = process.argv.slice(2);
if (a.includes('--probe')) { console.log('OK'); process.exit(0); }
if (a.includes('--capabilities')) { console.log(JSON.stringify({ vendor: 'broken', reads_repo: true, reads_web: true })); process.exit(0); }
process.stderr.write('adapter: the broken CLI is signed out\n');
process.exit(Number(process.env.BROKEN_EXIT || 6));
EOF
  P="$(make_project --git)"
  bash -c "cd '$P' && BRIDGIE_HOME='$C' node '$C/bin/bridgie.mjs' init --lane product && BRIDGIE_HOME='$C' node '$C/bin/bridgie.mjs' bet new b --title T" >/dev/null
  printf 'routing:\n  fallback: [fake]\n  tiers:\n    judgment: { adapter: broken }\n    production: { adapter: broken }\n    scout: { adapter: broken }\n' >> "$P/.bridgie/policy.yaml"
}
seat_run() { bash -c "cd '$P' && BRIDGIE_HOME='$C' $* node '$C/bin/bridgie.mjs' seat-run b decide/grill"; }

@test "an adapter that cannot run warns and falls back to the next one, keeping its log" {
  run seat_run
  echo "$output"
  [ "$status" -eq 0 ]
  [[ "$output" == *"warning: adapter broken exited 6 for seat grill: adapter: the broken CLI is signed out; falling back to fake"* ]]
  D="$P/.bridgie/runs/b/grill-01"
  [ -f "$D/seat-output.json" ]
  [ -f "$D/adapter-broken.log" ]
  grep -q '"used": "fake"' "$D/fallback.json"
  grep -q '"vendor": *"fake' "$D/adapter.json"
  [ "$(grep -c '"adapter"' "$D/cost.json")" -eq 2 ]
}

@test "a model that ran but answered badly does not fall back" {
  run seat_run BROKEN_EXIT=5
  [ "$status" -ne 0 ]
  [[ "$output" == *"adapter broken exited 5"* ]]
  [[ "$output" != *"falling back"* ]]
}

@test "BRIDGIE_ADAPTER pins one adapter, and routing.fallback: [] turns fallback off" {
  run seat_run BRIDGIE_ADAPTER=broken
  [ "$status" -ne 0 ]
  [[ "$output" != *"falling back"* ]]
  sed -i.bak 's/fallback: \[fake\]/fallback: []/' "$P/.bridgie/policy.yaml"
  run seat_run
  [ "$status" -ne 0 ]
  [[ "$output" == *"adapter broken exited 6"* ]]
  [[ "$output" != *"falling back"* ]]
}
