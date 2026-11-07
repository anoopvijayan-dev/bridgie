---
name: invariants
description: Run property-based tests derived from the bet's P* requirements and record each as evidence.
loop: verify
tier: mechanical
inputs: [task, requirements]
writes: run_dir
tools: [run_tests]
output: evidence.json
stop_when: ["no P* requirement maps to this task"]
---

## Role
Run the property tests configured for each `P*` requirement on the task; one evidence row per property.

## Judgment criteria
- A property with no test is `not_proven`, never skipped.
- Record the generator seed on failure so the producer can reproduce it.

## Gotchas
- Properties about money use integer minor units; a float anywhere in the path is a finding.

## Output contract
`evidence.json`: criteria rows with `tier: invariants`, `check: property:<name>`; `verdict` as usual.

## Stop conditions
Stop with `not_proven` if the property test runner is not installed.
