// bridgie shape <slug> [--approve | --changes "<what to change>"]
// Starts bridgie/<slug>, runs the shaper (requirements.md + design.md), raises approve_design.
import { basename, join } from 'node:path';
import * as st from '../state.mjs';
import * as fl from '../flow.mjs';
import { runSeat } from '../cli/seat.mjs';
import * as g from '../cli/git.mjs';
import { die, log, parseArgs, projectRoot, stateCommit, user, betStatus } from '../cli/core.mjs';

export default async function shape(argv) {
  const a = parseArgs(argv, { approve: 'bool', changes: 'value' }, 'shape');
  const slug = a._[0];
  if (!slug) die('usage: bridgie shape <slug> [--approve | --changes "..."]');
  const root = projectRoot();
  const status = betStatus(root, slug);
  if (status !== 'signed') die(`shape: bet '${slug}' is '${status}'; it must be signed first (bridgie open ${slug})`);

  if (a.approve || a.changes !== undefined) {
    const id = st.listDecisions(root, slug, { pending: true }).find(d => d.type === 'approve_design')?.id;
    if (!id) die(`shape: no design waiting for approval (run bridgie shape ${slug})`);
    try {
      if (a.approve) { fl.answer(root, slug, id, 'approve', { by: user() }); log(`design approved (${id}). Next: bridgie plan ${slug}`); }
      else { fl.answer(root, slug, id, 'request changes', { text: a.changes, by: user() }); log(`changes requested (${id}). Re-run: bridgie shape ${slug}`); }
    } catch (e) { die(e.message); }
    stateCommit(root, `shape ${slug}: ${a.approve ? 'approve' : 'changes'}`);
    return;
  }

  if (fl.designApproved(root, slug)) die(`shape: design for '${slug}' is already approved; next is bridgie plan ${slug}`);
  if (!g.isRepo(root)) die(`shape: ${root} is not a git repository; Build needs one (git init)`);
  g.requireClean(root);
  const base = g.featureStart(root, slug);
  const runDir = await runSeat(slug, 'build/shaper', { root });
  let ids;
  try { ids = fl.writeSpecFiles(root, slug, join(runDir, 'seat-output.json')).ids.join(' '); } catch (e) { die(`${e.message}\nshape: shaper output rejected`); }
  st.ingestQuestions(root, slug, join(runDir, 'seat-output.json'), basename(runDir));
  fl.ensureDecision(root, slug, 'approve_design', `Approve the design and requirements (${ids}) for '${slug}'? Branch bridgie/${slug} from ${base}.`, ['approve', 'request changes']);
  stateCommit(root, `shape ${slug} (${basename(runDir)})`);
  log(`shaped ${slug} on branch bridgie/${slug} (from ${base}): requirements ${ids}. Review and approve: bridgie open ${slug}   (or: bridgie shape ${slug} --approve)`);
}
