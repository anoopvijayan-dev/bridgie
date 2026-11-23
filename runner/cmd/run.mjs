// bridgie run <slug> — drive the bet as far as it can go without a human:
// shape → plan → (build → verify)* → accept packaging. Stops at every human decision.
// --parallel N: build up to N independent tasks at the same time (verify stays one at a time).
// --pause-before-verify: stop after each build so a person reads the change first ("I check, Bridgie
// verifies"); running it again verifies that task and builds the next.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as st from '../state.mjs';
import * as fl from '../flow.mjs';
import { BridgieExit, die, log, parseArgs, projectRoot, betStatus, stateCommit } from '../cli/core.mjs';

// step: one subcommand in-process; returns its exit code (0 ok, 2 verify failed, 3 waiting for a human).
async function step(name, slug, extra = []) {
  log(`→ bridgie ${name} ${slug}${extra.length ? ` ${extra.join(' ')}` : ''}`);
  const mod = await import(`./${name}.mjs`);
  try { await mod.default([slug, ...extra]); return 0; }
  catch (e) {
    if (!(e instanceof BridgieExit)) throw e;
    if (e.message) log(`bridgie: ${e.message}`);
    return e.code;
  }
}

export default async function run(argv) {
  const a = parseArgs(argv, { 'pause-before-verify': 'bool', parallel: 'value' }, 'run');
  const slug = a._[0];
  if (!slug) die('usage: bridgie run <slug> [--pause-before-verify] [--parallel N]');
  const root = projectRoot();
  const stop = rc => { if (rc === 3) return true; throw new BridgieExit('', rc); };
  let i = 0;
  for (; i < 60; i++) {
    const status = betStatus(root, slug);
    if (status === 'delivered' || status === 'evaluated') { log(`bet ${slug} is ${status}. Next: bridgie learn ${slug}`); return; }
    if (status !== 'signed') die(`run: bet '${slug}' is '${status}'; Decide comes first (bridgie grill ${slug}, then answer and sign on bridgie open ${slug})`);
    const pendingOf = type => st.listDecisions(root, slug, { pending: true }).some(d => d.type === type);
    if (!fl.designApproved(root, slug)) {
      if (pendingOf('approve_design')) { log(`waiting for you to approve the design: bridgie open ${slug}`); return; }
      const rc = await step('shape', slug); if (rc && stop(rc)) return; continue;
    }
    if (!existsSync(join(root, '.bridgie', 'specs', slug, 'tasks.json'))) { const rc = await step('plan', slug); if (rc && stop(rc)) return; continue; }
    if (fl.allPassed(root, slug)) {
      if (pendingOf('accept')) { log(`every task passed; waiting for your acceptance: bridgie open ${slug}`); return; }
      const af = fl.acceptancePath(root, slug);
      if (existsSync(af) && st.readFm(af).data.decision === 'rejected') { log(`acceptance was rejected; fix, then re-package with bridgie accept ${slug}`); return; }
      const rc = await step('accept', slug); if (rc && stop(rc)) return; continue;
    }
    const recovered = fl.recoverAttempts(root, slug);   // a killed run's in_progress tasks
    if (recovered.length) { stateCommit(root, `recover ${slug}: ${recovered.join(', ')}`); log(`recovered ${recovered.join(', ')}: the last attempt was interrupted and is not counted`); }
    const tasks = fl.loadTasks(root, slug).tasks;
    const states = tasks.map(t => `${t.id}:${t.status}`).join(' ');
    if (tasks.some(t => t.status === 'blocked')) { log(`a task is blocked (${states}); decide on bridgie open ${slug}`); return; }
    if (tasks.some(t => t.status === 'verify')) {
      const rc = await step('verify', slug);
      if (rc !== 0 && rc !== 2 && stop(rc)) return;   // 2 = verdict failed: loop on to retry
      continue;
    }
    if (fl.readyTasks(root, slug).length) {
      const rc = await step('build', slug, a.parallel !== undefined ? ['--parallel', a.parallel] : []); if (rc && stop(rc)) return;
      const waiting = fl.loadTasks(root, slug).tasks.filter(t => t.status === 'verify'), built = waiting[0];
      if (a['pause-before-verify'] && built) {
        if (waiting.length > 1) log(`paused before verify: ${waiting.map(t => t.id).join(', ')} are built, each on its own branch (${waiting.map(t => t.branch).join(', ')}). Read them, then run this again to verify them and build the next tasks`);
        else log(`paused before verify: ${built.id} is built on ${built.branch}. Read it (git diff bridgie/${slug}...${built.branch}), then run this again to verify it and build the next task`);
        return;
      }
      continue;
    }
    log(`nothing is ready (${states}); see bridgie status`); return;
  }
  die(`run: stopped after ${i} steps without finishing; see bridgie status`);
}
