// bridgie next — what to do next in this project, as exact commands. Also what plain `bridgie` prints.
import * as st from '../state.mjs';
import { findRoot } from '../cli/core.mjs';

// launchDue: a bet signed to learn by launching whose read-by date has come: its outcome metric, or null.
function launchDue(root, slug) {
  const { data } = st.readFm(st.betPath(root, slug));
  const m = data.outcome_metric;
  if (data.sign_track !== 'launch' || !m?.read_by || !['signed', 'delivered'].includes(data.status)) return null;
  return m.read_by <= st.today() ? m : null;
}

export default async function next() {
  const root = findRoot();
  const say = s => process.stdout.write(`${s}\n`);
  if (!root) {
    say('You are not inside a Bridgie project.');
    say('  bridgie new <folder>              start one (folder + git + state), then cd into it');
    say('  bridgie new <folder> --lane product    for ideas and company bets rather than code');
    say('  bridgie doctor                    check tools and model adapters');
    return;
  }
  const rows = st.status(root);
  if (!rows.length) {
    say(`Project: ${root} — no bets yet.`);
    say('  bridgie bet new <slug> --title "..."      write the idea down as a bet');
    say('  bridgie scout --from <folder>             or rank the problems in a folder of notes, tickets, emails first');
    say('  bridgie frame <slug> "<one-line idea>"    let an agent draft the bet body; assumptions become questions');
    return;
  }
  say(`Project: ${root}`);
  for (const r of rows) {
    const s = r.slug, lines = [];
    lines.push(`\n${s}: ${r.title} — ${r.status}, risk ${r.risk}, confidence ${r.confidence}${r.pending ? `, ${r.pending} decision(s) waiting` : ''}`);
    if (r.pending) lines.push(`  bridgie open ${s}                 answer the ${r.pending} decision(s) in your browser`);
    const due = launchDue(root, s);
    if (due) lines.push(`  read the outcome (due ${due.read_by}): ${due.name}, target ${due.target}${due.baseline ? `, baseline ${due.baseline}` : ''}; write the result in the bet, then bridgie learn ${s}`);
    switch (r.status) {
      case 'draft': lines.push(`  bridgie frame ${s} "<idea>"       draft the bet body (or edit .bridgie/bets/${s}/bet.md)`, `  bridgie grill ${s} --lenses       stress-test it and convene the board`); break;
      case 'grilling': case 'evidence':
        if (!r.pending) lines.push(`  bridgie research ${s}             competitors and prices from the web`, `  bridgie panel ${s}                simulated buyers: objections and a price range`, `  bridgie evidence ${s}             plan the real-world evidence; drop notes in .bridgie/bets/${s}/evidence/`, `  bridgie numbers ${s} --template   unit economics (required for money bets)`, `  bridgie sign ${s}                 commit to it once the evidence is in`);
        break;
      case 'signed': lines.push(`  bridgie run ${s}                  shape → plan → build → verify → accept, stopping at each decision`); break;
      case 'delivered': lines.push(`  bridgie learn ${s}                retrospective; then merge bridgie/${s} when you choose`); break;
      case 'killed': lines.push(`  (killed) bridgie learn ${s}       capture what was learned`); break;
    }
    say(lines.join('\n'));
  }
}
