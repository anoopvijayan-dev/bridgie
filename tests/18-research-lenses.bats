#!/usr/bin/env bats
load helpers

setup() {
  export BRIDGIE_ADAPTER=fake
  P="$(make_project --git)"
  bash -c "cd '$P' && bridgie init --lane product && bridgie bet new b --title 'Statement analysis for brokers'" >/dev/null
}

@test "research writes research.md with sources and raises its questions" {
  run bash -c "cd '$P' && bridgie research b"
  [ "$status" -eq 0 ]
  [[ "$output" == *"4 sources"* ]]
  grep -q 'StatementCo' "$P/.bridgie/bets/b/research.md"
  grep -q 'Which geography' "$P/.bridgie/decisions/b.json"
}

@test "research is refused on an adapter without web access, and without links" {
  run bash -c "cd '$P' && BRIDGIE_FAKE_READS_WEB=0 bridgie research b"
  [ "$status" -ne 0 ]
  [[ "$output" == *"needs web access"* ]]
  printf '{"seat":"researcher","summary_md":"s","artifact_md":"## Direct competitors\\nnone\\n## Indirect and substitutes\\n## Prices\\n## What their customers complain about\\n## Not found\\n## Sources\\n"}' > "$P/nolinks.json"
  run bash -c "cd '$P' && BRIDGIE_FAKE_OUTPUT='$P/nolinks.json' bridgie research b"
  [ "$status" -ne 0 ]
  [[ "$output" == *"output rejected"* ]]
  [ ! -e "$P/.bridgie/bets/b/research.md" ]
}

@test "a seat that stops to ask (no artifact, one question) raises the question and waits for the owner (exit 3)" {
  printf '{"seat":"researcher","summary_md":"stopped","artifact_md":null,"questions":[{"context":"STOP: which one person should the research cover?","options":["finance owner","agent builder"]}]}' > "$P/stop.json"
  run bash -c "cd '$P' && BRIDGIE_FAKE_OUTPUT='$P/stop.json' bridgie research b"
  [ "$status" -eq 3 ]
  [[ "$output" == *"stopped to ask first"* ]]
  [[ "$output" != *"output rejected"* ]]
  grep -q 'which one person' "$P/.bridgie/decisions/b.json"
  grep -q 'which one person' "$P/.bridgie/bets/b/bet.md"
  [ ! -e "$P/.bridgie/bets/b/research.md" ]
  run bash -c "cd '$P' && bridgie research b"                    # once answered, the next run writes the report
  [ "$status" -eq 0 ]
}

@test "lenses: three memos and a chair; the vote and average are computed by the runner" {
  run bash -c "cd '$P' && bridgie lenses b"
  [ "$status" -eq 0 ]
  [[ "$output" == *"board: 1 fund, 1 fund if, 1 pass (average 6.7/10)"* ]]
  grep -q '| moat | 5 | pass |' "$P/.bridgie/bets/b/board.md"
  grep -q 'Lenders refuse a standard pack' "$P/.bridgie/bets/b/board.md"
  grep -q 'How many applications' "$P/.bridgie/decisions/b.json"
  grep -q 'lens memos' "$P/.bridgie/runs/b/chair-01/prompt.md"
  grep -q 'Score: 5 | Vote: PASS' "$P/.bridgie/runs/b/chair-01/prompt.md"
}

@test "a memo without the score line is rejected and nothing is written" {
  printf '{"seat":"lens-offer","summary_md":"s","artifact_md":"I like it.\\n## What is strong\\n## What would kill it\\n## Conditions\\n"}' > "$P/bad.json"
  run bash -c "cd '$P' && BRIDGIE_FAKE_OUTPUT='$P/bad.json' bridgie lenses b"
  [ "$status" -ne 0 ]
  [[ "$output" == *"offer memo was rejected"* ]]
  [ ! -e "$P/.bridgie/bets/b/board.md" ]
}

@test "grill --lenses runs the grill and then the board" {
  run bash -c "cd '$P' && bridgie grill b --lenses"
  [ "$status" -eq 0 ]
  [[ "$output" == *"sign decision ready"* ]]
  [[ "$output" == *"board: 1 fund"* ]]
  [ "$(fm "$P/.bridgie/bets/b/bet.md" status)" = '"evidence"' ]
}

@test "research checks its links itself and says so on the page" {
  # nothing listens on port 9 of this machine, so every link is 'could not be checked' without leaving it
  printf '{"seat":"researcher","summary_md":"s","artifact_md":"## Direct competitors\\n| Name | What | Price | Link |\\n|---|---|---|---|\\n| A | x | 1 | http://127.0.0.1:9/a |\\n\\n## Indirect and substitutes\\n- a spreadsheet\\n\\n## Prices\\n- nothing\\n\\n## What their customers complain about\\n- slow http://127.0.0.1:9/b\\n\\n## Not found\\n- n\\n\\n## Sources\\n- http://127.0.0.1:9/a\\n- http://127.0.0.1:9/b\\n- http://127.0.0.1:9/c\\n"}' > "$P/local.json"
  run bash -c "cd '$P' && BRIDGIE_NO_LINK_CHECK=0 BRIDGIE_FAKE_OUTPUT='$P/local.json' bridgie research b"
  [ "$status" -eq 0 ]
  grep -q '## Link check' "$P/.bridgie/bets/b/research.md"
  grep -q '0 answered, 0 dead, 3 could not be checked' "$P/.bridgie/bets/b/research.md"
}

@test "research with a competitor that has no link is rejected" {
  printf '{"seat":"researcher","summary_md":"s","artifact_md":"## Direct competitors\\n| Name | What | Price | Link |\\n|---|---|---|---|\\n| Remembered Ltd | x | 1 | their site |\\n\\n## Indirect and substitutes\\n\\n## Prices\\n\\n## What their customers complain about\\n- slow https://example.com/a\\n\\n## Not found\\n\\n## Sources\\n- https://example.com/a\\n- https://example.com/b\\n- https://example.com/c\\n"}' > "$P/unlinked.json"
  run bash -c "cd '$P' && BRIDGIE_FAKE_OUTPUT='$P/unlinked.json' bridgie research b"
  [ "$status" -ne 0 ]
  [[ "$output" == *"no link on"*"Remembered Ltd"* ]]
  [ ! -e "$P/.bridgie/bets/b/research.md" ]
}
