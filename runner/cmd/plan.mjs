// bridgie plan <slug> [--replan] — decomposer turns the approved design into tasks.json.
// Once tasks have progress, a plain plan is refused; --replan replaces the plan, archives the old task
// branches (bridgie-task-archive/<slug>/<stamp>/<task>) and supersedes pending decisions about tasks.
import { basename, join } from 'node:path';
import { existsSync } from 'node:fs';
import * as fl from '../flow.mjs';
import * as st from '../state.mjs';
import * as g from '../cli/git.mjs';
import { runSeat } from '../cli/seat.mjs';
import { die, log, parseArgs, projectRoot, stateCommit, user } from '../cli/core.mjs';

export default async function plan(argv) {
  const a = parseArgs(argv, { replan: 'bool' }, 'plan');
  const slug = a._[0];
  if (!slug) die('usage: bridgie plan <slug> [--replan]');
  const root = projectRoot();
  if (!fl.designApproved(root, slug)) die(`plan: the design for '${slug}' is not approved (bridgie open ${slug})`);
  const old = existsSync(st.tasksPath(root, slug)) ? fl.loadTasks(root, slug).tasks : [];
  const started = old.filter(t => t.status !== 'todo' || t.attempts > 0);
  if (started.length && !a.replan) die(`plan: '${slug}' already has task progress (${started.map(t => `${t.id} ${t.status}`).join(', ')}); to replace the plan run: bridgie plan ${slug} --replan (old task branches are archived, not deleted)`);
  const runDir = await runSeat(slug, 'build/decomposer', { root });
  let doc;
  try { doc = fl.writeTasksFromPlan(root, slug, join(runDir, 'seat-output.json')); } catch (e) { die(`${e.message}\nplan: decomposer output rejected; see ${runDir}`); }
  if (a.replan && old.length) {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
    const moved = g.archiveTaskBranches(root, slug, stamp);
    const closed = st.supersedeDecisions(root, slug, d => !!d.task || d.type === 'unblock', 're-planned; the task it was about was replaced', { by: user() });
    log(`re-planned: ${moved.length} task branch(es) archived under bridgie-task-archive/${slug}/${stamp}/${closed.length ? `; superseded ${closed.join(', ')}` : ''}`);
  }
  stateCommit(root, `plan ${slug} (${basename(runDir)})${a.replan ? ' --replan' : ''}`);
  const warnings = fl.planWarnings(root, slug);
  for (const w of warnings) log(`warning: ${w}`);
  if (warnings.length) log(`${warnings.length} ordering warning(s): fix the plan now (bridgie plan ${slug} --replan) or go on if the mentions are not real dependencies`);
  log(`planned ${slug}: ${doc.tasks.length} task(s). Next: bridgie build ${slug}   (or bridgie run ${slug})`);
}
