// bridgie rereview <slug> [--task T] [--all]
// A second review of work that already passed, by another model family than the one that built
// it. For when the routed reviewer was unavailable and the producer's own family reviewed instead:
// that is recorded on each task as review debt, and this clears it. Read-only: nothing is merged,
// no status changes. Each task's merged diff is reviewed against the bet's code as it stands now;
// blocker and major findings become a question for the owner.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as st from '../state.mjs';
import * as fl from '../flow.mjs';
import { runSeat } from '../cli/seat.mjs';
import * as g from '../cli/git.mjs';
import { BridgieExit, die, log, parseArgs, projectRoot, stateCommit, git, rel } from '../cli/core.mjs';

// mergeOf: the commit that merged a task into the feature branch, or null.
function mergeOf(root, slug, task) {
  const fb = g.featureBranch(slug);
  const subject = `bridgie: merge ${task} into ${fb}`;
  const r = git(['-C', root, 'log', '--format=%H%x09%s', '--merges', fb]);
  const hit = r.out.split('\n').map(l => l.split('\t')).find(([, s]) => s === subject);
  return hit ? hit[0] : null;
}

export default async function rereview(argv) {
  const a = parseArgs(argv, { task: 'value', all: 'bool' }, 'rereview');
  const slug = a._[0];
  if (!slug) die('usage: bridgie rereview <slug> [--task T] [--all]');
  const root = projectRoot();
  if (!existsSync(st.tasksPath(root, slug))) die(`rereview: no tasks for '${slug}'`);
  const doc = fl.loadTasks(root, slug);
  const debt = fl.reviewDebt(root, slug);
  let ids;
  if (a.task) {
    if (fl.getTask(doc, a.task).status !== 'passed') die(`rereview: task ${a.task} has not passed; bridgie verify reviews it`);
    ids = [a.task];
  } else ids = a.all ? doc.tasks.filter(t => t.status === 'passed').map(t => t.id) : [...debt.same, ...debt.unknown];
  if (!ids.length) { log(`no review debt on '${slug}': every passed task was reviewed by another model family than its producer's`); return; }

  const done = [];
  for (const id of ids) {
    const t = fl.getTask(fl.loadTasks(root, slug), id);
    const merge = mergeOf(root, slug, id);
    if (!merge) { log(`${id}: no merge commit found on ${g.featureBranch(slug)}; skipped`); continue; }
    // The packet: what the task merged, as the first review saw it.
    const packet = mkdtempSync(join(tmpdir(), 'bridgie-rereview-'));
    const d = args => git(['-C', root, 'diff', ...args, `${merge}^1`, merge, '--', '.', ':(exclude).bridgie', ':(exclude).bridgie/**']).out;
    const nl = x => (x ? `${x}\n` : '');
    writeFileSync(join(packet, 'diff.patch'), nl(d([])));
    writeFileSync(join(packet, 'diff-stat.txt'), nl(d(['--stat'])));
    writeFileSync(join(packet, 'files.txt'), nl(d(['--name-only'])));
    writeFileSync(join(packet, 'review-note.md'), `This is a second review of task ${id}, which already passed and was merged. The diff is what the task merged. The repository is the bet's code as it stands now, which holds later tasks too: judge each requirement against the code as it is now, and report a defect only if it is still there.\n`);
    // Another family than the producer's; when the producer is not known here, than the first reviewer's.
    const avoid = fl.producerVendor(root, slug, id) || t.review?.producer_vendor || t.review?.vendor || '';
    const wt = join(root, '.bridgie', 'worktrees', slug, `${id}-rereview`);
    if (existsSync(wt)) g.removeWorktree(root, wt);
    mkdirSync(join(root, '.bridgie', 'worktrees', slug), { recursive: true });
    g.ignoreWorktrees(root);
    const add = git(['-C', root, 'worktree', 'add', '-q', '--detach', wt, g.featureBranch(slug)]);
    if (!add.ok) die(`rereview: could not make a read-only worktree: ${add.err}`);
    let rvDir, failure = null;
    try { rvDir = await runSeat(slug, 'verify/reviewer', { root, task: id, cwd: wt, packet, needsRepo: true, avoidVendor: avoid }); } catch (e) { failure = e; }
    const dirty = git(['-C', wt, 'status', '--porcelain']).out.trim();
    g.removeWorktree(root, wt);
    rmSync(packet, { recursive: true, force: true });
    if (failure) {
      if (done.length) stateCommit(root, `rereview ${slug}: ${done.join(', ')}`);
      if (failure instanceof BridgieExit && failure.code === 3) die(`${failure.message}\nrereview: ${done.length} of ${ids.length} done (${done.join(', ') || 'none'}); run it again later for the rest`, 3);
      die(`${failure.message}\nrereview: the review of ${id} did not run; ${done.length} of ${ids.length} done`);
    }
    if (dirty) die(`rereview: the reviewer modified its read-only worktree while reviewing ${id}; that review is discarded`);
    const ev = st.readJson(join(rvDir, 'evidence.json'));
    let vendor = null; try { vendor = st.readJson(join(rvDir, 'adapter.json')).vendor || null; } catch { /* unknown */ }
    const count = sev => ev.findings.filter(f => f.severity === sev).length;
    const record = { run: rel(root, rvDir), adapter: ev.verifier?.adapter || null, vendor, verdict: ev.verdict, blocker: count('blocker'), major: count('major'), minor: count('minor'), cross_family: vendor && avoid ? vendor !== avoid : null, at: st.now() };
    fl.setTask(root, slug, id, { review: { ...(t.review || { adapter: null, vendor: null, producer_vendor: avoid || null, cross_family: null }), rereview: record } });
    const serious = ev.findings.filter(f => f.severity === 'blocker' || f.severity === 'major');
    if (serious.length) {
      st.addDecision(root, slug, { type: 'question', task: id, allow_free_text: true, raised_by: { seat: 'reviewer', run: rel(root, rvDir) },
        context: `A second review of ${id} (passed and merged) by ${record.adapter} found ${record.blocker} blocker and ${record.major} major finding(s): ${serious.map(f => `${f.severity}: ${f.claim}${f.file ? ` (${f.file}:${f.line ?? '?'})` : ''}`).join(' | ')}. Evidence: ${record.run}/evidence.json`,
        options: ['fix it', 'accept as a limitation', 'not a defect'] });
    }
    done.push(id);
    log(`${id}: ${ev.verdict} by ${record.adapter}${vendor ? ` (${vendor})` : ''}: ${record.blocker} blocker, ${record.major} major, ${record.minor} minor${serious.length ? '; a question was raised (bridgie open)' : ''}`);
  }
  if (done.length) stateCommit(root, `rereview ${slug}: ${done.join(', ')}`);
  const left = fl.reviewDebt(root, slug);
  log(`re-reviewed ${done.length} task(s). Review debt left: ${left.same.length + left.unknown.length ? [...left.same, ...left.unknown].join(', ') : 'none'}`);
}
