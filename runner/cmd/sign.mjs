// bridgie sign <slug> [--kill | --more-evidence] — answers the pending "sign" decision.
import * as st from '../state.mjs';
import * as fl from '../flow.mjs';
import { actor, die, log, parseArgs, projectRoot, stateCommit, betStatus } from '../cli/core.mjs';

export default async function sign(argv) {
  const a = parseArgs(argv, { kill: 'bool', 'more-evidence': 'bool', relayed: 'bool' }, 'sign');
  const slug = a._[0];
  if (!slug) die('usage: bridgie sign <slug> [--kill | --more-evidence]');
  const answer = a.kill ? 'kill' : a['more-evidence'] ? 'need more evidence' : 'sign';
  const root = projectRoot();
  const status = betStatus(root, slug);
  if (status !== 'evidence') die(`sign: bet '${slug}' is '${status}'; it must be in 'evidence' (run 'bridgie grill ${slug}' first)`);
  try {
    const id = st.ensureSignDecision(root, slug).id;
    fl.answer(root, slug, id, answer, actor(a.relayed));
    stateCommit(root, `sign ${slug}: ${answer}`);
    log(`bet ${slug}: ${answer} (${id})`);
  } catch (e) { die(e.message); }
}
