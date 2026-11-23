// bridgie status — one line per bet, plus pending decisions.
// bridgie status --cost [slug] — where each bet's time went, task by task.
import * as st from '../state.mjs';
import * as fl from '../flow.mjs';
import { die, parseArgs, projectRoot } from '../cli/core.mjs';

export default async function status(argv = []) {
  const a = parseArgs(argv, { cost: 'bool' }, 'status');
  const root = projectRoot();
  if (a.cost) {
    const slugs = a._[0] ? [a._[0]] : st.listBets(root);
    if (a._[0] && !st.listBets(root).includes(a._[0])) die(`status: no bet '${a._[0]}'`);
    for (const slug of slugs) {
      const rows = fl.costByTask(root, slug);
      if (!rows.some(r => r.runs)) { process.stdout.write(`${slug}: no runs yet\n\n`); continue; }
      process.stdout.write(`${slug}\n${fl.costTable(rows)}\n\n`);
    }
    return;
  }
  process.stdout.write(`${st.statusTable(st.status(root))}\n`);
  // Adapters at a usage limit on this machine: seats routed to them wait or fall back until then.
  for (const [a, v] of Object.entries(st.adapterState(root))) {
    if (st.exhaustedUntil(root, a)) process.stdout.write(`\n${a} is at its usage limit until ${v.exhausted_until.replace(/\.\d+Z$/, 'Z')}; seats routed to it fall back or wait until then\n`);
  }
  // Review debt: passed tasks reviewed by their producer's own model family, where policy asks for another.
  for (const slug of st.listBets(root)) {
    let debt; try { if (!fl.crossFamily(root, slug)) continue; debt = fl.reviewDebt(root, slug); } catch { continue; }
    if (debt.same.length) process.stdout.write(`\n${slug}: review debt on ${debt.same.length} task(s) reviewed by the producer's own model family (${debt.same.join(', ')}): bridgie rereview ${slug}\n`);
  }
  const pending = st.listDecisions(root, null, { pending: true });
  if (pending.length) {
    process.stdout.write(`\n${pending.length} decision(s) waiting: bridgie open\n`);
    for (const d of pending) process.stdout.write(`  ${d.bet}  ${d.id}  ${d.type.padEnd(8)} ${d.context.slice(0, 70)}\n`);
  }
}
