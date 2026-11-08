# shellcheck shell=bash
# bridgie next — what to do next in this project, as exact commands. Also what plain `bridgie` prints.
# shellcheck source=../lib/common.sh
source "$BRIDGIE_HOME/runner/lib/common.sh"

cmd_next() {
  local root
  if ! root="$(find_root)"; then
    cat <<'TXT'
You are not inside a Bridgie project.
  bridgie new <folder>              start one (folder + git + state), then cd into it
  bridgie new <folder> --lane product    for ideas and company bets rather than code
  bridgie doctor                    check tools and model adapters
TXT
    return 0
  fi
  local rows; rows="$(node_run state.mjs status "$root")"
  if [[ "$rows" == "[]" ]]; then
    cat <<TXT
Project: $root — no bets yet.
  bridgie bet new <slug> --title "..."      write the idea down as a bet
  bridgie scout --from <folder>             or rank the problems in a folder of notes, tickets, emails first
  bridgie frame <slug> "<one-line idea>"    let an agent draft the bet body; assumptions become questions
TXT
    return 0
  fi
  echo "Project: $root"
  node -e '
    const rows = JSON.parse(process.argv[1]);
    for (const r of rows) {
      const s = r.slug, lines = [];
      lines.push(`\n${s}: ${r.title} — ${r.status}, risk ${r.risk}, confidence ${r.confidence}${r.pending ? `, ${r.pending} decision(s) waiting` : ""}`);
      if (r.pending) lines.push(`  bridgie open ${s}                 answer the ${r.pending} decision(s) in your browser`);
      switch (r.status) {
        case "draft": lines.push(`  bridgie frame ${s} "<idea>"       draft the bet body (or edit .bridgie/bets/${s}/bet.md)`, `  bridgie grill ${s} --lenses       stress-test it and convene the board`); break;
        case "grilling": case "evidence":
          if (!r.pending) lines.push(`  bridgie research ${s}             competitors and prices from the web`, `  bridgie panel ${s}                simulated buyers: objections and a price range`, `  bridgie evidence ${s}             plan the real-world evidence; drop notes in .bridgie/bets/${s}/evidence/`, `  bridgie numbers ${s} --template   unit economics (required for money bets)`, `  bridgie sign ${s}                 commit to it once the evidence is in`);
          break;
        case "signed": lines.push(`  bridgie run ${s}                  shape → plan → build → verify → accept, stopping at each decision`); break;
        case "delivered": lines.push(`  bridgie learn ${s}                retrospective; then merge bridgie/${s} when you choose`); break;
        case "killed": lines.push(`  (killed) bridgie learn ${s}       capture what was learned`); break;
      }
      console.log(lines.join("\n"));
    }' "$rows"
}
