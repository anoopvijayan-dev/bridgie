// bridgie verify <slug> [--task T]
// Verifies ONE task in status "verify": diff packet (R8), risk-path ack (R9), mechanical tiers,
// a read-only reviewer in a detached worktree (R3, R10, R11), reconcile (R4, R5), merge on pass.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as st from '../state.mjs';
import * as fl from '../flow.mjs';
import { runSeat, adapterCapabilities } from '../cli/seat.mjs';
import * as g from '../cli/git.mjs';
import { HOME, BridgieExit, die, log, waitHuman, parseArgs, projectRoot, stateCommit, git } from '../cli/core.mjs';
import { loadSeat } from '../context.mjs';
import { requireGovernance } from './build.mjs';

function nextRunDir(root, slug, name) {
  const runs = join(root, '.bridgie', 'runs', slug); mkdirSync(runs, { recursive: true });
  const n = readdirSync(runs).filter(d => d.startsWith(`${name}-`) && statSync(join(runs, d)).isDirectory()).length + 1;
  return join(runs, `${name}-${String(n).padStart(2, '0')}`);
}

function checkReviewer(root, slug, task) {   // R10 and R11, before any model is called
  const r = st.route(root, loadSeat('verify/reviewer').manifest);
  const { caps } = adapterCapabilities(r.adapter, join(HOME, 'seats', 'verify', 'reviewer'), r.model);
  // Every adapter that could review is known to be at its usage limit: say so before running a tier.
  const all = [r.adapter, ...st.fallbacks(root, r.adapter)];
  if (all.every(a => st.exhaustedUntil(root, a))) {
    const until = all.map(a => st.exhaustedUntil(root, a)).sort()[0];
    die(`waiting: the reviewer's adapter${all.length > 1 ? 's' : ''} (${all.join(', ')}) ${all.length > 1 ? 'are' : 'is'} at ${all.length > 1 ? 'their' : 'its'} usage limit until ${until.replace(/\.\d+Z$/, 'Z')}. ${task} stays in verify with its attempt not used; run it again after that`, 3);
  }
  if (caps.reads_repo !== true) die(`verify: reviewer adapter '${r.adapter}' cannot read the repository; a packet-only review is refused (R10)`);
  if (fl.crossFamily(root, slug) && fl.producerVendor(root, slug, task) === caps.vendor) die(`verify: reviewer vendor '${caps.vendor}' is the same as the producer's; policy requires a different model family (set routing.seats.reviewer)`);
}

// runMechanical: every required tier's commands, run in the platform shell inside the worktree.
// A required tier with no configured command becomes a not_proven row (never silently skipped).
export function runMechanical(root, slug, wt, vdir, skip = []) {
  const rows = [];
  let n = 0;
  for (const x of fl.mechanicalPlan(root, slug, wt, skip)) {
    n++;
    const logf = join(vdir, `${x.tier}-${n}.log`);
    let check = x.cmd, result;
    if (x.missing) {
      log(`  ${x.tier}: no command configured (required at this risk) → not_proven`);
      check = `no command configured for required tier ${x.tier} (set verify.commands.${x.tier} in .bridgie/policy.yaml)`;
      result = 'not_proven';
      writeFileSync(logf, '');
    } else {
      log(`  ${x.tier}: ${x.cmd}`);
      const fd = openSync(logf, 'w');
      const r = spawnSync(x.cmd, { cwd: wt, shell: true, stdio: ['ignore', fd, fd] });   // cmd.exe on Windows, sh elsewhere
      closeSync(fd);
      result = r.status === 0 ? 'pass' : 'fail';
    }
    rows.push({ id: `${x.tier}:${n}`, tier: x.tier, check, result, artifact: logf });
  }
  writeFileSync(join(vdir, 'mechanical.json'), JSON.stringify(rows) + '\n');
  return rows;
}

// reviewRecord: who reviewed a passing attempt, and whether that was another model family than the
// producer's — facts the runner knows from the adapters it launched, kept on the task so a
// same-family review is visible debt instead of a silent pass.
export function reviewRecord(root, slug, task, adapter = null, rvDir = null) {
  const producer = fl.producerVendor(root, slug, task) || null;
  let vendor = null;
  if (rvDir) { try { const caps = st.readJson(join(rvDir, 'adapter.json')); vendor = caps.vendor || null; } catch { /* unknown */ } }
  if (rvDir && !adapter) { try { adapter = st.readJson(join(rvDir, 'evidence.json')).verifier?.adapter || null; } catch { /* unknown */ } }
  if (!vendor && adapter) { try { vendor = adapterCapabilities(adapter, join(HOME, 'seats', 'verify', 'reviewer')).caps.vendor || null; } catch { /* unknown */ } }
  return { adapter, vendor, producer_vendor: producer, cross_family: vendor && producer ? vendor !== producer : null, at: st.now() };
}

// mechanicalKey: what the tier results depend on — the task, the commit tested and the commands.
export function mechanicalKey(root, slug, wt, task, skip = []) {
  const sha = git(['-C', wt, 'rev-parse', 'HEAD']).out.trim();
  const plan = createHash('sha256').update(JSON.stringify(fl.mechanicalPlan(root, slug, wt, skip))).digest('hex');
  return { task, sha, plan };
}
// reusableMechanical: the rows of the newest earlier verify run with the same key, or null.
export function reusableMechanical(root, slug, key) {
  const runs = join(root, '.bridgie', 'runs', slug);
  const dirs = existsSync(runs) ? readdirSync(runs).filter(d => /^verify-\d+$/.test(d)).sort((a, b) => Number(b.slice(7)) - Number(a.slice(7))) : [];
  for (const d of dirs) {
    const kf = join(runs, d, 'mechanical-key.json'), mf = join(runs, d, 'mechanical.json');
    if (!existsSync(kf) || !existsSync(mf)) continue;
    try {
      const k = st.readJson(kf);
      if (k.task === key.task && k.sha === key.sha && k.plan === key.plan) return { run: d, rows: st.readJson(mf) };
    } catch { /* an unreadable earlier run is not reused */ }
  }
  return null;
}

export default async function verify(argv) {
  const a = parseArgs(argv, { task: 'value' }, 'verify');
  const slug = a._[0];
  if (!slug) die('usage: bridgie verify <slug> [--task T]');
  const root = projectRoot();
  g.onFeature(root, slug);
  requireGovernance(root, slug, 'verify');
  let task = a.task;
  if (!task) {
    task = fl.loadTasks(root, slug).tasks.find(t => t.status === 'verify')?.id;
    if (!task) die(`verify: no task of '${slug}' is waiting for verification (bridgie build ${slug})`);
  }
  if (fl.getTask(fl.loadTasks(root, slug), task).status !== 'verify') die(`verify: task ${task} is not in status verify`);
  // The task may have been built on another machine: re-create its worktree from the task branch.
  const wt = g.restoreTaskWorktree(root, slug, task);
  if (!wt) die(`verify: no worktree or branch for ${task} (${g.taskBranch(slug, task)}); if it was built elsewhere, push that branch there and git fetch here`);
  g.commitAll(wt, `bridgie: ${task} manual changes before verify`);

  // 1. packet (R8) and risk paths (R9)
  const vdir = nextRunDir(root, slug, 'verify'); mkdirSync(vdir, { recursive: true });
  g.diffPacket(root, slug, task, vdir);
  const files = readFileSync(join(vdir, 'files.txt'), 'utf8').split(/\r?\n/).filter(Boolean);
  const risk = fl.riskOfPaths(root, slug, files);
  const paths = risk.paths.join(', ') || 'no risk paths';
  // Effective risk = max(bet, requirements, changed paths); a raise is persistent and logged.
  if (st.raiseRisk(root, slug, risk.effective, `task ${task} changes ${paths}`).changed) log(`risk raised to ${risk.effective} by the paths task ${task} changes`);
  if (risk.needs_ack) {
    if (fl.ackDeclined(root, slug)) die(`verify: the risk acknowledgement for '${slug}' was declined`);
    if (!fl.ackRecorded(root, slug)) {
      fl.ensureDecision(root, slug, 'ack_risk', `Task ${task} is risk ${risk.effective} (changes: ${paths}). Policy requires a human acknowledgement before verification.`, ['ack', 'decline'], { risk: risk.effective });
      stateCommit(root, `ack requested for ${slug} (${task})`);
      waitHuman(`verify: ${task} touches ${risk.effective} paths; waiting for a human ack (bridgie ack ${slug}, or bridgie open ${slug})`);
    }
  }

  // 2. reviewer preconditions (R10, R11)
  checkReviewer(root, slug, task);
  // 3. mechanical tiers in the task worktree, unless an earlier verify of this same commit already
  // ran the same commands (its reviewer could not run): tests are not re-run to wait for a reviewer.
  // A small task drops the tiers policy.sizes.small names, unless what it builds or changes is risky.
  const profile = fl.taskProfile(root, slug, task, files);
  if (profile.reason) log(`  ${task} was planned small but is treated as ${profile.size}: ${profile.reason}`);
  else if (profile.skip_tiers.length) log(`  ${task} is ${profile.size}: skipping ${profile.skip_tiers.join(', ')} (policy sizes.${profile.size})`);
  const key = mechanicalKey(root, slug, wt, task, profile.skip_tiers);
  const kept = reusableMechanical(root, slug, key);
  if (kept) {
    writeFileSync(join(vdir, 'mechanical.json'), JSON.stringify(kept.rows) + '\n');
    log(`  tiers: reusing the results of ${kept.run} for the same commit (${key.sha.slice(0, 10)})`);
  } else runMechanical(root, slug, wt, vdir, profile.skip_tiers);
  writeFileSync(join(vdir, 'mechanical-key.json'), JSON.stringify(key) + '\n');

  // 3b. The owner accepted the last review's findings as known limitations for this commit: the
  // tiers must still pass, and then the task merges without asking the reviewer again. A commit
  // that changed since is reviewed afresh.
  const acc = fl.getTask(fl.loadTasks(root, slug), task).accepted;
  if (acc && fl.getTask(fl.loadTasks(root, slug), task).status === 'verify' && !acc.merged) {
    const rows = st.readJson(join(vdir, 'mechanical.json'));
    if (acc.sha && acc.sha !== key.sha) {
      fl.setTask(root, slug, task, { accepted: null });
      log(`  the accepted limitations were for commit ${acc.sha.slice(0, 10)}; the task is now at ${key.sha.slice(0, 10)}, so it is reviewed again`);
    } else if (rows.some(r => r.result !== 'pass')) {
      fl.setTask(root, slug, task, { accepted: null });
      log(`  a tier no longer passes (${rows.filter(r => r.result !== 'pass').map(r => r.id).join(', ')}): accepted limitations cannot cover it, so the task is reviewed again`);
    } else {
      const prev = st.readJson(acc.evidence);
      const evidence = { ...prev, task, criteria: [...prev.criteria.filter(c => c.tier === 'adversarial'), ...rows],
        accepted_limitations: { by: acc.by, at: acc.at, reason: acc.reason, sha: key.sha } };
      st.writeJsonAtomic(join(vdir, 'evidence.json'), evidence, 'evidence');
      g.mergeTask(root, slug, task);
      fl.markPassed(root, slug, task, join(vdir, 'evidence.json'), { accepted: { ...acc, sha: key.sha, merged: true }, review: reviewRecord(root, slug, task, prev.verifier?.adapter) });
      stateCommit(root, `verify ${slug} ${task}: pass with accepted limitations`);
      log(`verified ${task}: pass with ${acc.findings.length} accepted limitation(s) (${acc.by}: ${acc.reason}); merged into bridgie/${slug}`);
      return;
    }
  }

  // 4. reviewer in a detached, read-only worktree (R3)
  const rv = g.reviewWorktree(root, slug, task);
  let rvDir, failure = null;
  try { rvDir = await runSeat(slug, 'verify/reviewer', { root, task, cwd: rv, packet: vdir, needsRepo: true, avoidVendor: fl.crossFamily(root, slug) ? fl.producerVendor(root, slug, task) : '' }); } catch (e) { failure = e; }
  const dirty = git(['-C', rv, 'status', '--porcelain']).out.trim();
  g.removeWorktree(root, rv);
  if (failure?.code === 3) die(`${failure.message}\nverify: ${task} stays in verify, with its attempt not used; the tier results for this commit are kept and will not be run again`, 3);
  if (failure) die(`${failure.message}\nverify: reviewer run failed for ${task}; task stays in verify`);
  if (dirty) {
    writeFileSync(join(rvDir, 'VIOLATION'), `reviewer changed files in its read-only worktree:\n${dirty}\n`);
    die(`verify: the reviewer modified its read-only worktree; run failed (R3, see ${join(rvDir, 'VIOLATION')})`);
  }
  fl.stampTask(join(rvDir, 'evidence.json'), task);

  // 5. reconcile (R4, R5) and merge on pass
  let verdict;
  try { verdict = fl.reconcile(root, slug, task, join(rvDir, 'evidence.json'), st.readJson(join(vdir, 'mechanical.json')), join(vdir, 'evidence.json')).verdict; }
  catch (e) { die(`verify: reconcile failed: ${e.message}`); }
  if (verdict === 'pass') {
    // Who reviewed, read before the merge removes nothing it needs: the reviewer's run folder stays.
    const review = reviewRecord(root, slug, task, null, rvDir);
    g.mergeTask(root, slug, task);
    fl.markPassed(root, slug, task, join(vdir, 'evidence.json'), { review });
    stateCommit(root, `verify ${slug} ${task}: pass`);
    if (review.cross_family === false) log(`  note: ${task} was reviewed by ${review.adapter}, the producer's own model family (${review.vendor}); bridgie rereview ${slug} gives it a second-family review`);
    log(`verified ${task}: pass; merged into bridgie/${slug}`);
    return;
  }
  stateCommit(root, `verify ${slug} ${task}: ${verdict}`);
  const t = fl.getTask(fl.loadTasks(root, slug), task);
  log(`verified ${task}: ${verdict} → ${t.status}. ${t.escalation || ''}`);
  if (t.status === 'blocked') log(`Decide what happens next: bridgie open ${slug}`);
  throw new BridgieExit('', 2);
}
