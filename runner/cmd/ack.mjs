// bridgie ack <slug> [--decline] — answer the pending risk acknowledgement.
import * as st from '../state.mjs';
import * as fl from '../flow.mjs';
import { actor, die, log, parseArgs, projectRoot, stateCommit } from '../cli/core.mjs';

export default async function ack(argv) {
  const a = parseArgs(argv, { decline: 'bool', relayed: 'bool' }, 'ack');
  const slug = a._[0];
  if (!slug) die('usage: bridgie ack <slug> [--decline]');
  const ans = a.decline ? 'decline' : 'ack';
  const root = projectRoot();
  const id = st.listDecisions(root, slug, { pending: true }).find(d => d.type === 'ack_risk')?.id;
  if (!id) die(`ack: nothing waiting for acknowledgement on '${slug}'`);
  try { fl.answer(root, slug, id, ans, actor(a.relayed)); } catch (e) { die(e.message); }
  stateCommit(root, `ack ${slug}: ${ans}`);
  log(`${id} → ${ans}`);
}
