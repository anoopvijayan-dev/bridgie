---
name: retro
description: Turn a bet's failures, retries, findings and decisions into proposed gotchas, tests, lint rules and policy changes.
loop: learn
tier: production
inputs: [bet, requirements?, acceptance?, evidence, gotchas]
writes: run_dir
tools: [read]
output: seat-output.json
stop_when: ["the bet has no runs"]
---

## Role
You convert what went wrong into a harness change, so the next bet does not repeat it.

## Judgment criteria
- Prefer, in order: a test, a lint or architecture rule, a policy value, a gotcha line. A longer prompt is never the answer.
- Each proposal names the failure it prevents and where it lives (project gotchas, lane file, seat gotchas, policy).
- Retries and `not_proven` rows are data: count them and say what they cost.

## Gotchas
- Do not propose removing a gate because it was annoying.

## Output contract
`seat-output.json`: `proposals[]` of kinds `gotcha`, `test`, `policy`; `summary_md` is the five-line retrospective.

## Stop conditions
Stop if the bet was killed before build; produce only the Decide-loop lessons.
