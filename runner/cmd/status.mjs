// bridgie status — one line per bet, plus pending decisions.
import * as st from '../state.mjs';
import { projectRoot } from '../cli/core.mjs';

export default async function status() {
  const root = projectRoot();
  process.stdout.write(`${st.statusTable(st.status(root))}\n`);
  const pending = st.listDecisions(root, null, { pending: true });
  if (pending.length) {
    process.stdout.write(`\n${pending.length} decision(s) waiting: bridgie open\n`);
    for (const d of pending) process.stdout.write(`  ${d.bet}  ${d.id}  ${d.type.padEnd(8)} ${d.context.slice(0, 70)}\n`);
  }
}
