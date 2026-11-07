#!/usr/bin/env bats
load helpers

setup() {
  export BRIDGIE_ADAPTER=fake
  P="$(make_project --git)"
  bash -c "cd '$P' && bridgie init && bridgie bet new b --title 'Net collect' --risk none && bridgie grill b" >/dev/null
}

start_server() {   # start_server → sets URL and SERVER_PID
  LOG="$(mktemp)"
  ( cd "$P" && exec bridgie open --no-browser --port 0 > "$LOG" 2>&1 3>&- ) &
  SERVER_PID=$!
  for _ in $(seq 1 50); do grep -q LISTENING "$LOG" 2>/dev/null && break; sleep 0.1; done
  URL="$(grep LISTENING "$LOG" | head -1 | awk '{print $2}')"
  [ -n "$URL" ]
}
teardown() { if [[ -n "${SERVER_PID:-}" ]]; then kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true; fi; }

@test "static render writes read-only pages" {
  run bash -c "cd '$P' && bridgie open --static"
  [ "$status" -eq 0 ]
  [ -f "$P/.bridgie/ui/index.html" ] && [ -f "$P/.bridgie/ui/bet-b.html" ]
  grep -q 'bridgie decide b D1' "$P/.bridgie/ui/bet-b.html"
}

@test "inbox and bet pages render pending decisions (R12)" {
  start_server
  run curl -s "$URL/"
  [[ "$output" == *"3 pending"* ]]
  [[ "$output" == *"Does anyone retry"* ]]
  run curl -s "$URL/bet/b"
  [[ "$output" == *'name="id" value="D1"'* ]]
  [[ "$output" == *"Sign is blocked"* ]]
}

@test "answering from the surface writes through the single writer and re-renders (R13)" {
  start_server
  run curl -s -o /dev/null -w '%{http_code}' -X POST "$URL/decide" --data 'slug=b&id=D1&answer=no'
  [ "$output" = "303" ]
  grep -q '"answer": "no"' "$P/.bridgie/decisions/b.json"
  grep -q 'D1 (question): no' "$P/.bridgie/bets/b/bet.md"
  run curl -s "$URL/bet/b"
  [[ "$output" != *'name="id" value="D1"'* ]]
}

@test "free text and don't know (R14) from the surface" {
  start_server
  curl -s -o /dev/null -X POST "$URL/decide" --data 'slug=b&id=D1&answer=__text__&text=finance%20does%20it%20on%20Fridays'
  grep -q 'Fridays' "$P/.bridgie/bets/b/bet.md"
  curl -s -o /dev/null -X POST "$URL/decide" --data "slug=b&id=D2&answer=don't%20know"
  grep -q '\[ \] E1:' "$P/.bridgie/bets/b/bet.md"
}

@test "invalid answers return 400 and change nothing" {
  start_server
  before="$(cat "$P/.bridgie/decisions/b.json")"
  run curl -s -o /dev/null -w '%{http_code}' -X POST "$URL/decide" --data 'slug=b&id=D1&answer=maybe'
  [ "$output" = "400" ]
  run curl -s -o /dev/null -w '%{http_code}' -X POST "$URL/decide" --data 'slug=b&id=D3&answer=sign'
  [ "$output" = "400" ]
  [ "$(cat "$P/.bridgie/decisions/b.json")" = "$before" ]
}

@test "surface and CLI produce identical state (P3)" {
  start_server
  curl -s -o /dev/null -X POST "$URL/decide" --data 'slug=b&id=D1&answer=no'
  curl -s -o /dev/null -X POST "$URL/decide" --data 'slug=b&id=D2&answer=measured'
  curl -s -o /dev/null -X POST "$URL/decide" --data 'slug=b&id=D3&answer=sign'
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
  run curl -s "$URL/bet/s"
  [[ "$output" == *"Approve design"* ]]
  [[ "$output" == *"Event-driven retry"* ]]
  id="$(node "$BRIDGIE_HOME/runner/flow.mjs" pending-of-type "$Q" s approve_design)"
  run curl -s -o /dev/null -w '%{http_code}' -X POST "$URL/decide" --data "slug=s&id=$id&answer=approve"
  [ "$output" = "303" ]
  [ "$(node "$BRIDGIE_HOME/runner/flow.mjs" design-approved "$Q" s)" = "true" ]
}
