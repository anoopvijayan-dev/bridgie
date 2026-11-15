#!/usr/bin/env bats
load helpers

setup() {
  export BRIDGIE_ADAPTER=fake
  P="$(make_project --git)"
  bash -c "cd '$P' && bridgie init && bridgie bet new b --title 'Net collect' --risk none && bridgie grill b" >/dev/null
}

start_server() {   # start_server [open args] → sets URL, TOKEN, JAR (signed-in cookie jar) and SERVER_PID
  LOG="$(mktemp)"; JAR="$(mktemp)"
  ( cd "$P" && exec bridgie open --no-browser --port 0 "$@" > "$LOG" 2>&1 3>&- ) &
  SERVER_PID=$!
  for _ in $(seq 1 50); do grep -q '^OPEN ' "$LOG" 2>/dev/null && break; sleep 0.1; done
  URL="$(grep LISTENING "$LOG" | head -1 | awk '{print $2}')"
  OPEN="$(grep '^OPEN ' "$LOG" | head -1 | awk '{print $2}')"
  TOKEN="${OPEN##*t=}"
  [ -n "$URL" ]
  [ -n "$TOKEN" ]
  curl -s -o /dev/null -c "$JAR" "$OPEN"
}
get() { curl -s -b "$JAR" "$URL$1"; }
post() { curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -X POST "$URL/decide" --data "csrf=$TOKEN&$1"; }
teardown() { if [[ -n "${SERVER_PID:-}" ]]; then kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true; fi; }

@test "static render writes read-only pages" {
  run bash -c "cd '$P' && bridgie open --static"
  [ "$status" -eq 0 ]
  [ -f "$P/.bridgie/ui/index.html" ]
  [ -f "$P/.bridgie/ui/bet-b.html" ]
  grep -q 'bridgie decide b D1' "$P/.bridgie/ui/bet-b.html"
}

@test "inbox and bet pages render pending decisions (R12)" {
  start_server
  run get /
  [[ "$output" == *"3 pending"* ]]
  [[ "$output" == *"Does anyone retry"* ]]
  run get /bet/b
  [[ "$output" == *'name="id" value="D1"'* ]]
  [[ "$output" == *"Sign is blocked"* ]]
}

@test "answering from the surface writes through the single writer and re-renders (R13)" {
  start_server
  run post 'slug=b&id=D1&answer=no'
  [ "$output" = "303" ]
  grep -q '"answer": "no"' "$P/.bridgie/decisions/b.json"
  grep -q 'D1 (question): no' "$P/.bridgie/bets/b/bet.md"
  run get /bet/b
  [[ "$output" != *'name="id" value="D1"'* ]]
}

@test "free text and don't know (R14) from the surface" {
  start_server
  post 'slug=b&id=D1&answer=__text__&text=finance%20does%20it%20on%20Fridays'
  grep -q 'Fridays' "$P/.bridgie/bets/b/bet.md"
  post "slug=b&id=D2&answer=don't%20know"
  grep -q '\[ \] E1:' "$P/.bridgie/bets/b/bet.md"
}

@test "invalid answers return 400 and change nothing" {
  start_server
  before="$(cat "$P/.bridgie/decisions/b.json")"
  run post 'slug=b&id=D1&answer=maybe'
  [ "$output" = "400" ]
  run post 'slug=b&id=D3&answer=sign'
  [ "$output" = "400" ]
  [ "$(cat "$P/.bridgie/decisions/b.json")" = "$before" ]
}

@test "surface and CLI produce identical state (P3)" {
  start_server
  post 'slug=b&id=D1&answer=no'
  post 'slug=b&id=D2&answer=measured'
  post 'slug=b&id=D3&answer=sign'
  [ "$(fm "$P/.bridgie/bets/b/bet.md" status)" = '"signed"' ]
  Q="$(make_project --git)"
  bash -c "cd '$Q' && bridgie init && bridgie bet new b --title 'Net collect' --risk none && bridgie grill b && bridgie decide b D1 no && bridgie decide b D2 measured && bridgie sign b" >/dev/null
  norm() { sed -E 's/"(created_at|decided_at|signed_at)": "[^"]*"/"\1": "T"/g; s/^created: .*/created: X/; s/^signed_at: .*/signed_at: X/; s/^- [0-9-]{10} /- DATE /' "$1"; }
  diff <(norm "$P/.bridgie/decisions/b.json") <(norm "$Q/.bridgie/decisions/b.json")
  diff <(norm "$P/.bridgie/bets/b/bet.md") <(norm "$Q/.bridgie/bets/b/bet.md")
}

@test "approving the design from the page applies the flow effect" {
  Q="$(make_project --git)"; signed_bet "$Q" s
  (cd "$Q" && bridgie shape s) >/dev/null 2>&1
  P="$Q"; start_server
  run get /bet/s
  [[ "$output" == *"Approve design"* ]]
  [[ "$output" == *"Event-driven retry"* ]]
  id="$(node "$BRIDGIE_HOME/runner/flow.mjs" pending-of-type "$Q" s approve_design)"
  run post "slug=s&id=$id&answer=approve"
  [ "$output" = "303" ]
  [ "$(node "$BRIDGIE_HOME/runner/flow.mjs" design-approved "$Q" s)" = "true" ]
}

@test "without the access link nothing is shown or decided (finding 5)" {
  start_server
  run curl -s -o /dev/null -w '%{http_code}' "$URL/bet/b"
  [ "$output" = "401" ]
  run curl -s -o /dev/null -w '%{http_code}' -X POST "$URL/decide" --data 'slug=b&id=D1&answer=no'
  [ "$output" = "401" ]
  run curl -s -o /dev/null -w '%{http_code}' "$URL/?t=forged-token"
  [ "$output" = "401" ]
  ! grep -q '"answer": "no"' "$P/.bridgie/decisions/b.json"
}

@test "a forged cross-origin or token-less request is refused even with the cookie" {
  start_server
  run curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -H 'Origin: http://evil.example' -X POST "$URL/decide" --data "csrf=$TOKEN&slug=b&id=D1&answer=no"
  [ "$output" = "403" ]
  run curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -X POST "$URL/decide" --data 'slug=b&id=D1&answer=no'
  [ "$output" = "403" ]
  run curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -H "Host: attacker.example:${URL##*:}" "$URL/bet/b"
  [ "$output" = "403" ]
  ! grep -q '"answer": "no"' "$P/.bridgie/decisions/b.json"
}

@test "each invited person decides as themselves" {
  start_server --invite second
  [ "$(post 'slug=b&id=D1&answer=no')" = "303" ]
  link="$(grep '^Link for second:' "$LOG" | awk '{print $4}')"
  J2="$(mktemp)"; curl -s -o /dev/null -c "$J2" "$link"
  T2="${link##*t=}"
  [ "$(curl -s -o /dev/null -w '%{http_code}' -b "$J2" -X POST "$URL/decide" --data "csrf=$T2&slug=b&id=D2&answer=measured")" = "303" ]
  node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).decisions; if (d[0].decided_by!=="tester"||d[1].decided_by!=="second") process.exit(1)' "$P/.bridgie/decisions/b.json"
  [ "$(curl -s -o /dev/null -w '%{http_code}' -b "$J2" -X POST "$URL/decide" --data "csrf=$TOKEN&slug=b&id=D3&answer=sign")" = "403" ]
}

@test "decisions are refused while an agent runs, and the page says why" {
  start_server
  mkdir "$P/.bridgie/.seat-lock"
  printf '{"seat":"implementer","run_dir":"x","since":"%s","pid":1}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$P/.bridgie/.seat-lock/owner.json"
  run curl -s -b "$JAR" -X POST "$URL/decide" --data "csrf=$TOKEN&slug=b&id=D1&answer=no"
  [[ "$output" == *"agent run is in progress"* ]]
  ! grep -q '"answer": "no"' "$P/.bridgie/decisions/b.json"
}

@test "the bet page shows what the decide loop found, with computed headlines, and the confidence card applies" {
  Q="$(make_project --git)"
  bash -c "cd '$Q' && bridgie init --lane product && bridgie bet new d --title 'Packs' && bridgie research d && bridgie lenses d && bridgie numbers d --template && bridgie numbers d" >/dev/null 2>&1
  bash -c "cd '$Q' && bridgie panel d" >/dev/null 2>&1 || true
  bash -c "cd '$Q' && bridgie panel d --n 6" >/dev/null 2>&1
  mkdir -p "$Q/.bridgie/bets/d/evidence"; echo 'broker 1 notes' > "$Q/.bridgie/bets/d/evidence/n1.md"
  bash -c "cd '$Q' && BRIDGIE_FAKE_OUTPUT='$BRIDGIE_HOME/adapters/fake/fixtures/evidence.2.json' bridgie evidence d" >/dev/null 2>&1
  P="$Q"; start_server
  run get /bet/d
  [[ "$output" == *"What the decide loop found"* ]]
  [[ "$output" == *"1 fund, 1 fund if, 1 pass · 6.7/10"* ]]
  [[ "$output" == *"buy rate 60% of 5 · upper bound, not evidence"* ]]
  [[ "$output" == *"profitable on these inputs"* ]]
  [[ "$output" == *"StatementCo"* ]]
  [[ "$output" == *"Confidence proposal"* ]]
  id="$(node "$BRIDGIE_HOME/runner/flow.mjs" pending-of-type "$Q" d confidence)"
  [ "$(post "slug=d&id=$id&answer=accept%20anecdote")" = "303" ]
  [ "$(fm "$Q/.bridgie/bets/d/bet.md" confidence)" = '"anecdote"' ]
  run get /bet/d
  [[ "$output" != *"Confidence proposal"* ]]
}

@test "a bet with nothing from the decide loop shows no such section" {
  start_server
  run get /bet/b
  [[ "$output" != *"What the decide loop found"* ]]
}
