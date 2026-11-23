// bridgie build <slug> [--task T] [--harden] [--parallel N]
// Builds one ready task: fresh worktree, implementer (and hardener), runner commits, status → verify.
// With --parallel N (or policy build.parallel): up to N independent ready tasks at the same time.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, sep } from 'node:path';
import * as st from '../state.mjs';
import * as fl from '../flow.mjs';
import { runSeat, seatLock, seatUnlock } from '../cli/seat.mjs';
import * as g from '../cli/git.mjs';
import { snapshot, check, restore } from '../guard.mjs';
import { BridgieExit, die, log, waitHuman, parseArgs, projectRoot, stateCommit } from '../cli/core.mjs';

// requireBuildAck: R9 pre-build half — risk levels whose policy needs a human ack.
export function requireBuildAck(root, slug) {
  const bet = st.readFm(st.betPath(root, slug)).data;
  if (!st.lanePolicy(st.loadPolicy(root), bet.lane, bet.risk).human_ack_before_build) return;
  const needs = bet.risk;
  if (fl.ackDeclined(root, slug)) die(`build: the risk acknowledgement for '${slug}' was declined`);
  if (fl.ackRecorded(root, slug)) return;
  fl.ensureDecision(root, slug, 'ack_risk', `Bet '${slug}' is risk '${needs}'; policy requires a human acknowledgement before agents build or verify it.`, ['ack', 'decline'], { risk: needs });
  stateCommit(root, `ack requested for ${slug}`);
  waitHuman(`build: waiting for a human ack of risk '${needs}' (bridgie ack ${slug}, or bridgie open ${slug})`);
}

// requireGovernance: nothing is built, verified or accepted under rules weaker than the bet was
// signed under until the owner has decided (exit 3).
export function requireGovernance(root, slug, cmd) {
  const gate = fl.governanceGate(root, slug);
  if (!gate) return;
  if (!gate.kept) stateCommit(root, `governance decision raised for ${slug}`);
  waitHuman(`${cmd}: policy is weaker than the rules '${slug}' was signed under: ${gate.drift.join('; ')}. ${gate.kept
    ? `${gate.decision} kept the signed rules: put .bridgie/policy.yaml back, then run this again`
    : `The owner decides ${gate.decision} (bridgie decide ${slug} ${gate.decision} "accept the change" | "keep the signed rules", or bridgie open ${slug})`}`);
}

// TaskFail: one task's build could not finish. Thrown instead of writing state, so that several
// tasks can be built side by side and their outcomes recorded afterwards, one at a time.
// `reason` goes on the task; `code` 3 means the attempt never ran (a model CLI at its usage limit).
class TaskFail extends Error {
  constructor(message, { reason, commit, code = 1 }) { super(message); this.reason = reason; this.commit = commit; this.code = code; }
}

// produce: one producer run with all guards; returns the run directory. Writes no Bridgie state.
async function produce(root, slug, task, seat, wt, packet, seatOpts = {}) {
  const name = basename(seat), at = g.head(wt);
  let runDir;
  try { runDir = await runSeat(slug, seat, { root, task, cwd: wt, packet, ...seatOpts }); }
  catch (e) {
    if (!(e instanceof BridgieExit)) throw e;
    g.resetTask(wt, at);
    if (e.code === 3) throw new TaskFail(e.message, { reason: `${name} did not run (${/usage limit/.test(e.message) ? 'a model CLI was at its usage limit' : e.message.split('\n')[0].slice(0, 160)}); the attempt is not counted`, commit: `${name} waiting`, code: 3 });
    throw new TaskFail(`${e.message}\nbuild: ${name} failed for ${task}; attempt recorded`, { reason: `${name} run failed (see .bridgie/runs/${slug})`, commit: `${name} failed` });
  }
  const changes = g.bridgieChanges(root, slug, task);
  if (changes.length) {
    g.resetTask(wt, at);
    writeFileSync(join(runDir, 'VIOLATION'), `seat ${name} edited Bridgie state inside its worktree:\n${changes.join('\n')}\n`);
    throw new TaskFail(`build: ${name} edited .bridgie/ in the worktree; attempt discarded (see ${join(runDir, 'VIOLATION')})`, { reason: `${name} edited .bridgie/ in its worktree; attempt discarded`, commit: 'violation' });
  }
  fl.stampTask(join(runDir, 'claim.json'), task);
  g.commitAll(wt, `bridgie: ${task} ${name} (run ${basename(runDir)})`);
  return runDir;
}

// buildTask: implementer, then the hardener when the task's size or the bet's risk asks for one.
// Returns the implementer's run directory; throws TaskFail. Writes no Bridgie state.
async function buildTask(root, slug, task, wt, a, seatOpts = {}) {
  const runDir = await produce(root, slug, task, 'build/implementer', wt, undefined, seatOpts);
  const risk = st.readFm(st.betPath(root, slug)).data.risk;
  // The hardener runs for a risky bet, unless the task is small (and nothing it builds is risky);
  // a large task is hardened whatever the bet's risk; --harden always.
  const profile = fl.taskProfile(root, slug, task);
  const byRisk = ['money', 'data', 'security', 'infra'].includes(risk);
  const harden = a.harden || (profile.harden ?? byRisk);
  if (!harden && byRisk) log(`${task} is small: no hardener (policy sizes.small)`);
  if (profile.reason) log(`${task} was planned small but is treated as ${profile.size}: ${profile.reason}`);
  if (harden) {
    const packet = mkdtempSync(join(tmpdir(), 'bridgie-harden-'));
    try { g.diffPacket(root, slug, task, packet); await produce(root, slug, task, 'build/hardener', wt, packet, seatOpts); }
    finally { rmSync(packet, { recursive: true, force: true }); }
  }
  return runDir;
}

// record: write one task's outcome to state (the caller commits).
function record(root, slug, task, fail) {
  if (!fail) fl.setTask(root, slug, task, { status: 'verify' });
  else if (fail.code === 3) fl.unstartAttempt(root, slug, task, fail.reason);
  else fl.failAttempt(root, slug, task, fail.reason);
}

// width: how many independent tasks to build at once (--parallel N, else policy build.parallel).
function width(root, flag) {
  const n = flag !== undefined ? Number(flag) : Number(st.loadPolicy(root).build?.parallel ?? 1);
  if (!Number.isInteger(n) || n < 1 || n > 16) die(`build: --parallel takes a whole number from 1 to 16 (got ${flag ?? st.loadPolicy(root).build?.parallel})`);
  return n;
}

export default async function build(argv) {
  const a = parseArgs(argv, { task: 'value', harden: 'bool', parallel: 'value' }, 'build');
  const slug = a._[0];
  if (!slug) die('usage: bridgie build <slug> [--task T] [--harden] [--parallel N]');
  const root = projectRoot();
  if (!existsSync(join(root, '.bridgie', 'specs', slug, 'tasks.json'))) die(`build: no tasks for '${slug}' (bridgie plan ${slug})`);
  const n = width(root, a.parallel);
  g.onFeature(root, slug);
  requireGovernance(root, slug, 'build');
  requireBuildAck(root, slug);
  // A task a dead run left in_progress is recovered first, so a restart needs no hand edit.
  const recovered = fl.recoverAttempts(root, slug);
  if (recovered.length) { stateCommit(root, `recover ${slug}: ${recovered.join(', ')}`); log(`recovered ${recovered.join(', ')}: the last attempt was interrupted and is not counted`); }
  const ready = fl.readyTasks(root, slug).map(t => t.id);
  let batch;
  if (a.task) {
    if (!ready.includes(a.task)) die(`build: task ${a.task} is not ready (blocked, passed, out of attempts, or waiting on dependencies)`);
    batch = [a.task];
  } else {
    const pick = fl.pickBatch(root, slug, n);
    batch = pick.batch;
    for (const h of pick.held) log(`${h.task} waits for the next batch: it touches the same files as ${h.with} (${h.paths.join(' and ')})`);
    if (!batch.length) die(`build: no ready tasks for '${slug}' (bridgie status)`);
  }

  // One task: as before, the seat run takes the lock itself.
  if (batch.length === 1) {
    const [task] = batch;
    const wt = g.taskWorktree(root, slug, task);
    try { fl.startAttempt(root, slug, task, g.taskBranch(slug, task)); } catch (e) { die(e.message); }
    let runDir;
    try { runDir = await buildTask(root, slug, task, wt, a); }
    catch (e) {
      if (!(e instanceof TaskFail)) throw e;
      record(root, slug, task, e);
      stateCommit(root, `build ${slug} ${task}: ${e.commit}`);
      die(e.message, e.code);
    }
    record(root, slug, task);
    stateCommit(root, `build ${slug} ${task}`);
    log(`built ${task} (${basename(runDir)}). Next: bridgie verify ${slug}`);
    return;
  }

  // Several independent tasks, each in its own worktree and branch, built at the same time. Bridgie
  // state is written only before the seats start and after the last one ends: this process holds the
  // seat lock for the whole batch, and each seat's state guard ignores its siblings' run folders and
  // nothing else. Verification and merging stay one task at a time (bridgie verify).
  log(`building ${batch.length} independent tasks together: ${batch.join(', ')}`);
  const wts = {};
  for (const task of batch) {
    wts[task] = g.taskWorktree(root, slug, task);
    try { fl.startAttempt(root, slug, task, g.taskBranch(slug, task)); } catch (e) { die(e.message); }
  }
  const runDirs = [], heads = Object.fromEntries(batch.map(t => [t, g.head(wts[t])]));
  let violation = null;
  seatLock(root, 'build', join(root, '.bridgie', 'runs', slug));
  // One snapshot of the state for the whole batch, taken before any seat starts and kept in the
  // lock folder (which the guard never reads and the unlock removes).
  const snap = join(root, '.bridgie', '.seat-lock', 'snapshot');
  const seatOpts = { lock: false, snapshot: snap, exclude: () => runDirs, onRunDir: d => runDirs.push(d), onViolation: d => { violation ??= d; } };
  let results;
  try {
    try { snapshot(root, snap, []); } catch (e) { die(e.message); }
    results = await Promise.all(batch.map(async task => {
      try { return { task, runDir: await buildTask(root, slug, task, wts[task], a, seatOpts) }; }
      catch (e) {
        if (e instanceof TaskFail) return { task, fail: e };
        if (e instanceof BridgieExit) return { task, fail: new TaskFail(e.message, { reason: `build failed: ${e.message.split('\n')[0]}`, commit: 'failed', code: e.code === 3 ? 3 : 1 }) };
        return { task, fail: new TaskFail(String(e?.stack || e), { reason: `build crashed: ${e?.message || e}`, commit: 'failed' }) };
      }
    }));
    // A last look once every seat is done (a seat that finished early is not asked again otherwise).
    const rel = runDirs.map(d => relative(root, d).split(sep).join('/'));
    const d = check(root, snap, rel);
    if (d.added.length || d.removed.length || d.changed.length) { restore(root, snap, rel); violation ??= join(root, '.bridgie', 'runs', slug); }
  } finally { seatUnlock(root); }
  // State was edited while the batch ran. The runner cannot tell which seat did it, so nothing the
  // batch built is trusted: every task's attempt is discarded and its branch put back.
  if (violation) {
    for (const task of batch) {
      g.resetTask(wts[task], heads[task]);
      record(root, slug, task, { reason: 'Bridgie state was edited while this task was built beside others; the runner cannot tell which seat did it, so the whole batch was discarded', code: 1 });
    }
    stateCommit(root, `build ${slug} ${batch.join(', ')}: violation`);
    die(`build: a seat wrote to Bridgie state files while ${batch.join(', ')} were built together; state restored and every attempt of the batch discarded (see ${join(violation, 'VIOLATION')})`);
  }
  for (const r of results) record(root, slug, r.task, r.fail);
  const ok = results.filter(r => !r.fail), bad = results.filter(r => r.fail);
  stateCommit(root, `build ${slug} ${batch.join(', ')}${bad.length ? ` (${bad.map(r => `${r.task}: ${r.fail.commit}`).join('; ')})` : ''}`);
  for (const r of bad) log(`bridgie: ${r.task}: ${r.fail.message}`);
  if (ok.length) { log(`built ${ok.map(r => r.task).join(', ')}${bad.length ? `; ${bad.map(r => r.task).join(', ')} did not finish` : ''}. Next: bridgie verify ${slug}`); return; }
  if (bad.every(r => r.fail.code === 3)) die(`waiting: no task of the batch could run (${batch.join(', ')}); nothing was counted. Run it again after the usage limit resets`, 3);
  die(`build: none of ${batch.join(', ')} finished; attempts recorded`);
}
