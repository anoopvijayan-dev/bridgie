#!/usr/bin/env bats
load helpers

setup() {
  export BRIDGIE_ADAPTER=fake
  export BRIDGIE_EVALS_HOME="$(mktemp -d)"
  W="$(mktemp -d)"
}
# evidence the fake reviewer returns: one serious finding at the planted line of fee-rounding
naming_the_bug() {
  cat > "$W/evidence.json" <<'J'
{ "task": "T1", "criteria": [{ "id": "R1", "tier": "adversarial", "check": "billing/fees.py:16", "result": "fail", "artifact": null }],
  "findings": [{ "severity": "major", "file": "billing/fees.py", "line": 16, "criterion": "R1", "claim": "round() on a float rounds half to even, not half up", "repro": "card_fee(100) returns 2, the requirement says 3", "disposition": null }],
  "verdict": "fail", "verifier": { "seat": "reviewer", "adapter": "fake", "model": "default" } }
J
}

@test "eval reviewer: a reviewer that passes everything misses the planted bugs and raises no false alarm" {
  run bash -c "cd '$W' && bridgie eval reviewer --cases fee-rounding,statement-owner-check,clean-card-fee"
  [ "$status" -eq 0 ]
  [[ "$output" == *"testing reviewer fake on 3 case(s): 2 with a planted bug, 1 clean"* ]]
  [[ "$output" == *"fake (fake-verifier): caught 0 of 2 planted bugs; 0 false alarms on 1 clean change"* ]]
  [[ "$output" == *"missed fee-rounding: passed the change"* ]]
  node -e '
    const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).runs.at(-1);
    process.exit(r.adapter === "fake" && r.summary.caught === 0 && r.summary.planted === 2 && r.summary.clean === 1 && r.cases.length === 3 && r.complete === true ? 0 : 1)' "$BRIDGIE_EVALS_HOME/reviewer.json"
}

@test "eval reviewer: a finding that names the planted bug is a catch; the same finding on a clean change is a false alarm" {
  naming_the_bug
  run bash -c "cd '$W' && BRIDGIE_FAKE_OUTPUT='$W/evidence.json' bridgie eval reviewer --cases fee-rounding,clean-card-fee,statement-owner-check --parallel 1"
  [ "$status" -eq 0 ]
  [[ "$output" == *"caught 1 of 2 planted bugs; 1 false alarm on 1 clean change"* ]]
  [[ "$output" == *"missed statement-owner-check: verdict fail, for other reasons"* ]]
  [[ "$output" == *"false alarm clean-card-fee: round() on a float"* ]]
}

@test "eval reviewer: each case's own tests really run, and the reviewer is given their result" {
  run bash -c "cd '$W' && bridgie eval reviewer --cases fee-rounding --keep"
  [ "$status" -eq 0 ]
  kept="$(printf '%s\n' "$output" | sed -n 's/^  kept fee-rounding: //p')"
  [ -d "$kept" ]
  rv="$kept/.bridgie/runs/eval/reviewer-01"
  grep -q '"result":"pass"' "$rv/mechanical.json"
  grep -q 'OK' "$rv/specified-1.log"                                   # unittest's own summary line
  grep -q 'card_fee' "$rv/diff.patch"
  grep -q 'rounded half up to the penny' "$rv/prompt.md"                # the requirement
  grep -q 'test results (runner-run, read-only)' "$rv/prompt.md"
  grep -q 'card_fee() added in billing/fees.py' "$rv/prompt.md"         # the producer's claim
  [ -z "$(git -C "$kept" status --porcelain --untracked-files=no)" ]
  rm -rf "$kept"
}

@test "eval reviewer: unknown cases and bad arguments are refused" {
  run bash -c "cd '$W' && bridgie eval reviewer --cases nope"
  [ "$status" -ne 0 ]
  [[ "$output" == *'no eval case "nope"'* ]]
  run bash -c "cd '$W' && bridgie eval"
  [ "$status" -ne 0 ]
  [[ "$output" == *"usage: bridgie eval reviewer"* ]]
  run bash -c "cd '$W' && bridgie eval reviewer --parallel 0"
  [ "$status" -ne 0 ]
}

@test "doctor and the acceptance package say how the reviewer did against planted bugs, or that it was never tested" {
  P="$(make_project --git)"; signed_bet "$P" b
  printf 'routing:\n  seats:\n    reviewer: { adapter: codex }\n' >> "$P/.bridgie/policy.yaml"
  run bash -c "cd '$P' && BRIDGIE_ADAPTER= bridgie doctor"
  [[ "$output" == *"[warn] reviewer codex: never tested with planted bugs (bridgie eval reviewer --adapter codex)"* ]]
  mkdir -p "$BRIDGIE_EVALS_HOME"
  printf '{"runs":[{"adapter":"codex","model":"default","at":"2026-11-23T10:00:00Z","summary":{"ran":14,"planted":10,"caught":8,"clean":4,"false_alarms":1}}]}\n' > "$BRIDGIE_EVALS_HOME/reviewer.json"
  run bash -c "cd '$P' && BRIDGIE_ADAPTER= bridgie doctor"
  [[ "$output" == *"[ok] reviewer codex: caught 8 of 10 planted bugs; 1 false alarm on 4 clean changes, tested 2026-11-23"* ]]
  # the acceptance package names each reviewer that passed a task
  node -e '
    const fs = require("fs"), f = process.argv[1];
    fs.mkdirSync(require("path").dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify({ bet: "b", tasks: [{ id: "T1", title: "t", requirements: ["R1"], depends_on: [], status: "passed", attempts: 1, max_attempts: 3, branch: null, evidence: null, escalation: null,
      review: { adapter: "codex", vendor: "openai", cross_family: true } }, { id: "T2", title: "t", requirements: ["R1"], depends_on: [], status: "passed", attempts: 1, max_attempts: 3, branch: null, evidence: null, escalation: null,
      review: { adapter: "antigravity", vendor: "google", cross_family: true } }] }, null, 2));' "$P/.bridgie/specs/b/tasks.json"
  run node -e '
    import(require("node:url").pathToFileURL(process.argv[1] + "/runner/flow.mjs").href).then(fl => process.stdout.write(fl.acceptancePacket(process.argv[2], "b").md))' "$BRIDGIE_HOME" "$P"
  [[ "$output" == *"## Reviewer calibration"* ]]
  [[ "$output" == *"- codex: caught 8 of 10 planted bugs; 1 false alarm on 4 clean changes, tested 2026-11-23"* ]]
  [[ "$output" == *"- antigravity: never tested with planted bugs"* ]]
}
