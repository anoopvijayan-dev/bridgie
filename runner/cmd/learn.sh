# shellcheck shell=bash
# bridgie learn <slug> — the retro seat proposes tests, rules, gotchas and policy changes.
# Nothing is applied: proposals land in .bridgie/learn/ for a human to adopt.
# shellcheck source=../lib/seat.sh
source "$BRIDGIE_HOME/runner/lib/seat.sh"

cmd_learn() {
  local slug="${1:-}"; [[ -n "$slug" ]] || die "usage: bridgie learn <slug>"
  local root; root="$(project_root)"
  local status; status="$(node_run state.mjs fm-get "$root/.bridgie/bets/$slug/bet.md" status | tr -d '"')"
  local decided=""
  [[ -f "$root/.bridgie/acceptance/$slug.md" ]] && decided="$(node_run state.mjs fm-get "$root/.bridgie/acceptance/$slug.md" decision | tr -d '"')"
  [[ "$status" == "killed" || ( -n "$decided" && "$decided" != "pending" ) ]] || die "learn: '$slug' has no outcome yet (needs an accept decision, or a killed bet)"
  local run_dir; run_dir="$(run_seat "$slug" learn/retro)" || exit 1
  local out; out="$root/.bridgie/learn/proposals-$(date +%Y-%m-%d)-$slug.md"
  node -e '
    const o = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const lines = [`# Learn — ${process.argv[3]} (${new Date().toISOString().slice(0, 10)})`, "", o.summary_md, "", "## Proposals (not applied)", ""];
    for (const p of o.proposals || []) lines.push(`- [ ] **${p.kind}**: ${p.text}`);
    lines.push("", "Adopt a gotcha by adding it to .bridgie/learn/gotchas.md; tests and rules go in the code; policy changes in .bridgie/policy.yaml.", "");
    require("fs").writeFileSync(process.argv[2], lines.join("\n"));' "$run_dir/seat-output.json" "$out" "$slug"
  state_commit "$root" "learn $slug"
  log "proposals written to ${out#"$root"/}"
}
