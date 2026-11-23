// bridgie build <slug> [--task T] [--harden]
// Builds ONE ready task: fresh worktree, implementer (and hardener), runner commits, status → verify.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import * as st from '../state.mjs';
import * as fl from '../flow.mjs';
import { runSeat } from '../cli/seat.mjs';
import * as g from '../cli/git.mjs';
import { die, log, waitHuman, parseArgs, projectRoot, stateCommit } from '../cli/core.mjs';

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

// produce: one producer run with all guards; returns the run directory.
async function produce(root, slug, task, seat, wt, packet) {
  const name = basename(seat), at = g.head(wt);
  let runDir;
  try { runDir = await runSeat(slug, seat, { root, task, cwd: wt, packet }); }
  catch (e) {
    g.resetTask(wt, at);
    fl.failAttempt(root, slug, task, `${name} run failed (see .bridgie/runs/${slug})`);
    stateCommit(root, `build ${slug} ${task}: ${name} failed`);
    die(`${e.message}\nbuild: ${name} failed for ${task}; attempt recorded`);
  }
  const changes = g.bridgieChanges(root, slug, task);
  if (changes.length) {
    g.resetTask(wt, at);
    writeFileSync(join(runDir, 'VIOLATION'), `seat ${name} edited Bridgie state inside its worktree:\n${changes.join('\n')}\n`);
    fl.failAttempt(root, slug, task, `${name} edited .bridgie/ in its worktree; attempt discarded`);
    stateCommit(root, `build ${slug} ${task}: violation`);
    die(`build: ${name} edited .bridgie/ in the worktree; attempt discarded (see ${join(runDir, 'VIOLATION')})`);
  }
  fl.stampTask(join(runDir, 'claim.json'), task);
  g.commitAll(wt, `bridgie: ${task} ${name} (run ${basename(runDir)})`);
  return runDir;
}

export default async function build(argv) {
  const a = parseArgs(argv, { task: 'value', harden: 'bool' }, 'build');
  const slug = a._[0];
  if (!slug) die('usage: bridgie build <slug> [--task T] [--harden]');
  const root = projectRoot();
  if (!existsSync(join(root, '.bridgie', 'specs', slug, 'tasks.json'))) die(`build: no tasks for '${slug}' (bridgie plan ${slug})`);
  g.onFeature(root, slug);
  requireBuildAck(root, slug);
  // A task a dead run left in_progress is recovered first, so a restart needs no hand edit.
  const recovered = fl.recoverAttempts(root, slug);
  if (recovered.length) { stateCommit(root, `recover ${slug}: ${recovered.join(', ')}`); log(`recovered ${recovered.join(', ')}: the last attempt was interrupted and is not counted`); }
  const ready = fl.readyTasks(root, slug).map(t => t.id);
  let task;
  if (a.task) {
    if (!ready.includes(a.task)) die(`build: task ${a.task} is not ready (blocked, passed, out of attempts, or waiting on dependencies)`);
    task = a.task;
  } else {
    task = ready[0];
    if (!task) die(`build: no ready tasks for '${slug}' (bridgie status)`);
  }
  const wt = g.taskWorktree(root, slug, task);
  try { fl.startAttempt(root, slug, task, g.taskBranch(slug, task)); } catch (e) { die(e.message); }
  const runDir = await produce(root, slug, task, 'build/implementer', wt);
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
    try { g.diffPacket(root, slug, task, packet); await produce(root, slug, task, 'build/hardener', wt, packet); }
    finally { rmSync(packet, { recursive: true, force: true }); }
  }
  fl.setTask(root, slug, task, { status: 'verify' });
  stateCommit(root, `build ${slug} ${task}`);
  log(`built ${task} (${basename(runDir)}). Next: bridgie verify ${slug}`);
}
