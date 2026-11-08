#!/usr/bin/env bats
load helpers

setup() {
  export BRIDGIE_ADAPTER=fake
  P="$(make_project --git)"
  bash -c "cd '$P' && bridgie init --lane product" >/dev/null
  S="$P/inbox"; mkdir -p "$S/tickets" "$S/emails"
  echo 'Reading statements by hand takes all Tuesday' > "$S/tickets/t1.txt"
  echo 'statements again' > "$S/tickets/t2.txt"
  echo 'every lender has its own template' > "$S/tickets/t3.txt"
  printf 'Hi, I spend most of Tuesday on statements for one client' > "$S/emails/broker-a.txt"
  printf 'PK\003\004 binary' > "$S/photo.png"
}

@test "scout copies only text signals, writes a ranked opportunity list and records the run bet-less" {
  run bash -c "cd '$P' && bridgie scout --from inbox"
  [ "$status" -eq 0 ]
  [[ "$output" == *"scouting 4 file(s)"* ]]
  [[ "$output" == *"O1 Reading a year of bank statements by hand takes a day per application (4 sources, high)"* ]]
  [ -f "$P/.bridgie/scout/inbox/opportunities.md" ]
  [ -f "$P/.bridgie/runs/_scout/inbox/scout-01/signals/tickets__t1.txt" ]
  [ ! -e "$P/.bridgie/runs/_scout/inbox/scout-01/signals/photo.png" ]
  grep -q 'photo.png' "$P/.bridgie/runs/_scout/inbox/scout-01/signals/_index.json"
  grep -q 'takes all Tuesday' "$P/.bridgie/runs/_scout/inbox/scout-01/prompt.md"
  grep -q '"sources": 4' "$P/.bridgie/scout/inbox/opportunities.json"
}

@test "a scout output without source counts is rejected" {
  printf '{"seat":"scout","summary_md":"s","artifact_md":"## O1 · something\\nSeverity: high — x\\n"}' > "$P/bad.json"
  run bash -c "cd '$P' && BRIDGIE_FAKE_OUTPUT='$P/bad.json' bridgie scout --from inbox"
  [ "$status" -ne 0 ]
  [[ "$output" == *"output rejected"* ]]
  [ ! -e "$P/.bridgie/scout/inbox/opportunities.md" ]
}

@test "bet new --from seeds the bet body from the opportunity; unknown ids fail" {
  bash -c "cd '$P' && bridgie scout --from inbox" >/dev/null
  run bash -c "cd '$P' && bridgie bet new statements --from inbox/O1"
  [ "$status" -eq 0 ]
  grep -q 'most of Tuesday' "$P/.bridgie/bets/statements/bet.md"
  grep -q 'spreadsheets and a junior' "$P/.bridgie/bets/statements/bet.md"
  [ -f "$P/.bridgie/bets/statements/opportunity.md" ]
  run bash -c "cd '$P' && bridgie bet new other --from inbox/O9"
  [ "$status" -ne 0 ]
}

@test "frame replaces the five framed sections, keeps the rest, and raises the assumptions as questions" {
  bash -c "cd '$P' && bridgie bet new b --title 'Statement analysis'" >/dev/null
  run bash -c "cd '$P' && bridgie frame b 'AI reads bank statements for brokers'"
  [ "$status" -eq 0 ]
  [[ "$output" == *"2 assumption(s)"* ]]
  B="$P/.bridgie/bets/b/bet.md"
  grep -q '^## Idea' "$B" && grep -q 'AI reads bank statements' "$B"
  grep -q 'two to five staff' "$B"
  grep -q 'Open banking data' "$B"
  grep -q '^## Decision log' "$B" && grep -q '^## Evidence tasks' "$B"
  ! grep -q 'Who has this problem, in one or two sentences' "$B"
  grep -q 'Who pays' "$P/.bridgie/decisions/b.json"
  [ "$(fm "$B" status)" = '"draft"' ]
}

@test "frame is refused once the bet has been grilled" {
  bash -c "cd '$P' && bridgie bet new b && bridgie grill b" >/dev/null 2>&1
  run bash -c "cd '$P' && bridgie frame b"
  [ "$status" -ne 0 ]
  [[ "$output" == *"only a draft bet"* ]]
}
