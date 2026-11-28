#!/usr/bin/env bats
load helpers

# A bet in 'evidence' with every question answered and confidence still 'opinion'.
unsigned_bet() {   # unsigned_bet <slug> <lane> <risk>
  (
    cd "$P" || exit 1
    bridgie bet new "$1" --lane "$2" --risk "$3" >/dev/null 2>&1
    bridgie grill "$1" >/dev/null 2>&1
    bridgie decide "$1" D1 no >/dev/null 2>&1
    bridgie decide "$1" D2 measured >/dev/null 2>&1
  )
  [[ "$(fm "$P/.bridgie/bets/$1/bet.md" status)" == '"evidence"' ]]
}

setup() {
  export BRIDGIE_ADAPTER=fake
  P="$(make_project --git)"; bash -c "cd '$P' && bridgie init" >/dev/null
}

@test "a low-risk product bet below the bar can't be signed until it has a metric and a kill criterion" {
  unsigned_bet game product ux
  run bash -c "cd '$P' && bridgie sign game"
  [ "$status" -ne 0 ]
  [[ "$output" == *"below \"anecdote\""* ]]
  [[ "$output" == *"--metric"* ]]
  [[ "$output" == *"--kill"* ]]
  # a metric without a kill criterion is not enough
  bash -c "cd '$P' && bridgie bet set game --metric 'post impressions' --baseline 'median of last 10 posts' --target '3x baseline' --read-by 2027-01-15 --reason 'decide by launching'" >/dev/null
  run bash -c "cd '$P' && bridgie sign game"
  [ "$status" -ne 0 ]
  bash -c "cd '$P' && bridgie bet set game --kill 'under 1x baseline after 7 days' --reason 'decide by launching'" >/dev/null
  run bash -c "cd '$P' && bridgie sign game"
  [ "$status" -eq 0 ]
  B="$P/.bridgie/bets/game/bet.md"
  [ "$(fm "$B" status)" = '"signed"' ]
  [ "$(fm "$B" sign_track)" = '"launch"' ]
  [ "$(fm "$B" outcome_metric)" = '{"name":"post impressions","baseline":"median of last 10 posts","target":"3x baseline","read_by":"2027-01-15"}' ]
  [ "$(fm "$B" kill_criteria)" = '["under 1x baseline after 7 days"]' ]
  grep -q 'outcome metric → post impressions' "$B"
  grep -q 'kill criterion added: under 1x baseline after 7 days' "$B"
  run node "$BRIDGIE_HOME/runner/state.mjs" validate bet "$B"
  [ "$status" -eq 0 ]
}

@test "a bet whose lane and risk can't decide by launching still needs evidence" {
  unsigned_bet store product data
  bash -c "cd '$P' && bridgie bet set store --metric m --target t --read-by 2027-01-15 --kill k --reason r" >/dev/null
  run bash -c "cd '$P' && bridgie sign store"
  [ "$status" -ne 0 ]
  [[ "$output" == *"below \"anecdote\""* ]]
  [[ "$output" != *"--metric"* ]]
}

@test "bet set checks the read-by date and refuses metric changes once signed" {
  unsigned_bet game product ux
  run bash -c "cd '$P' && bridgie bet set game --metric m --target t --read-by 15/01/2027 --reason r"
  [ "$status" -ne 0 ]
  [[ "$output" == *"YYYY-MM-DD"* ]]
  bash -c "cd '$P' && bridgie bet set game --metric m --target t --read-by 2027-01-15 --kill k --reason r && bridgie sign game" >/dev/null
  run bash -c "cd '$P' && bridgie bet set game --target u --reason r"
  [ "$status" -ne 0 ]
  [[ "$output" == *"signed"* ]]
}

@test "next reminds the owner to read the outcome once the read-by date has passed" {
  unsigned_bet game product ux
  bash -c "cd '$P' && bridgie bet set game --metric 'post impressions' --target '3x baseline' --read-by 2026-01-01 --kill k --reason r && bridgie sign game" >/dev/null
  run bash -c "cd '$P' && bridgie next"
  [ "$status" -eq 0 ]
  [[ "$output" == *"read the outcome"* ]]
  [[ "$output" == *"post impressions"* ]]
  [[ "$output" == *"bridgie learn game"* ]]
}
