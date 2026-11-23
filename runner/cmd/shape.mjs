// bridgie shape <slug> [--approve | --changes "<what to change>"]
// Starts bridgie/<slug>, runs the shaper (requirements.md + design.md), raises approve_design.
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import * as st from '../state.mjs';
import * as fl from '../flow.mjs';
import { runSeat } from '../cli/seat.mjs';
import * as g from '../cli/git.mjs';
import { die, log, parseArgs, projectRoot, stateCommit, user, betStatus } from '../cli/core.mjs';

export default async function shape(argv) {
  const a = parseArgs(argv, { approve: 'bool', changes: 'value', amend: 'value' }, 'shape');
  const slug = a._[0];
  if (!slug) die('usage: bridgie shape <slug> [--approve | --changes "..." | --amend "..."]');
  const root = projectRoot();
  const status = betStatus(root, slug);
  if (status !== 'signed') die(`shape: bet '${slug}' is '${status}'; it must be signed first (bridgie open ${slug})`);

  // --amend re-opens an approved design: it records the change as "request changes" on a new
  // approve_design decision, so the shaper revises on the next run and the owner approves again.
  // The plan and task progress stay; a revision that drops a requirement a task cites is reported.
  if (a.amend !== undefined) {
    if (!a.amend.trim()) die('shape: --amend needs the change, e.g. --amend "R4: ambiguous wording goes to the judgement queue"');
    if (!fl.designApproved(root, slug)) die(`shape: the design for '${slug}' is not approved yet; use --changes on the pending approval`);
    const d = st.addDecision(root, slug, { type: 'approve_design', context: `Amend the approved design for '${slug}'?`, options: ['approve', 'request changes'], allow_free_text: true });
    try { fl.answer(root, slug, d.id, 'request changes', { text: a.amend, by: user() }); } catch (e) { die(e.message); }
    stateCommit(root, `shape ${slug}: amend`);
    log(`amendment recorded (${d.id}); the design is re-opened. Re-run: bridgie shape ${slug}, then approve the revision`);
    return;
  }

  if (a.approve || a.changes !== undefined) {
    const id = st.listDecisions(root, slug, { pending: true }).find(d => d.type === 'approve_design')?.id;
    if (!id) die(`shape: no design waiting for approval (run bridgie shape ${slug})`);
    try {
      if (a.approve) { fl.answer(root, slug, id, 'approve', { by: user() }); log(`design approved (${id}). Next: ${existsSync(join(root, '.bridgie', 'specs', slug, 'tasks.json')) ? `the plan stands; bridgie run ${slug}` : `bridgie plan ${slug}`}`); }
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
  // After an amendment the plan stays: say so if the revision dropped an id a task still cites.
  const have = new Set(ids.split(' '));
  const dropped = existsSync(join(root, '.bridgie', 'specs', slug, 'tasks.json'))
    ? [...new Set(fl.loadTasks(root, slug).tasks.flatMap(t => t.requirements || []))].filter(r => !have.has(r)) : [];
  const note = dropped.length ? ` The plan's tasks cite ${dropped.join(', ')}, which this revision no longer has; after approving, re-plan with bridgie plan ${slug} --replan.` : '';
  fl.ensureDecision(root, slug, 'approve_design', `Approve the design and requirements (${ids}) for '${slug}'? Branch bridgie/${slug} from ${base}.${note}`, ['approve', 'request changes']);
  stateCommit(root, `shape ${slug} (${basename(runDir)})`);
  log(`shaped ${slug} on branch bridgie/${slug} (from ${base}): requirements ${ids}.${note} Review and approve: bridgie open ${slug}   (or: bridgie shape ${slug} --approve)`);
}
