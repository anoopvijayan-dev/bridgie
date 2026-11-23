import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as st from './state.mjs';
import * as fl from './flow.mjs';

const REQS = `# Requirements\n\n## R1 · event · risk: none\nWHEN a THE SYSTEM SHALL b\n\n## R2 · event · risk: money\nWHEN c THE SYSTEM SHALL d\n\n## P1 · property\nFor any x, y SHALL hold.\nValidates: R2\n`;

function project(risk = 'none', policy = 'version: 1\n') {
  const root = mkdtempSync(join(tmpdir(), 'bridgie-flow-'));
  for (const d of ['bets', 'specs', 'runs', 'acceptance', 'decisions', 'learn']) mkdirSync(join(root, '.bridgie', d), { recursive: true });
  writeFileSync(join(root, '.bridgie', 'policy.yaml'), policy);
  st.betNew(root, 'b', { title: 'B', lane: 'engineering', risk, owner: 'tester' });
  mkdirSync(join(root, '.bridgie', 'specs', 'b'), { recursive: true });
  writeFileSync(join(root, '.bridgie', 'specs', 'b', 'requirements.md'), REQS);
  return root;
}
function planOutput(root, tasks) {
  const f = join(root, 'plan-out.json');
  writeFileSync(f, JSON.stringify({ seat: 'decomposer', summary_md: 's', artifact_md: '```json\n' + JSON.stringify({ tasks }) + '\n```' }));
  return f;
}
const T = (id, requirements, depends_on = []) => ({ id, title: `task ${id}`, requirements, depends_on });

test('requirementIds reads R and P headings', () => {
  assert.deepEqual(fl.requirementIds(project(), 'b'), ['R1', 'R2', 'P1']);
});

test('writeTasksFromPlan validates mapping, ids, deps and cycles', () => {
  const root = project();
  assert.throws(() => fl.writeTasksFromPlan(root, 'b', planOutput(root, [T('T1', ['R1'])])), /not covered by any task: R2, P1 \(P ids are correctness properties/);
  assert.throws(() => fl.writeTasksFromPlan(root, 'b', planOutput(root, [T('T1', ['R1', 'R2', 'P1', 'R9'])])), /unknown requirement R9/);
  assert.throws(() => fl.writeTasksFromPlan(root, 'b', planOutput(root, [T('T1', ['R1'], ['T2']), T('T2', ['R2', 'P1'], ['T1'])])), /cycle/);
  assert.throws(() => fl.writeTasksFromPlan(root, 'b', planOutput(root, [T('T1', ['R1', 'R2', 'P1'], ['T7'])])), /unknown task T7/);
  const doc = fl.writeTasksFromPlan(root, 'b', planOutput(root, [T('T1', ['R1']), T('T2', ['R2', 'P1'], ['T1'])]));
  assert.equal(doc.tasks[1].status, 'todo');
  assert.equal(doc.tasks[1].max_attempts, 3);
  assert.ok(existsSync(st.tasksPath(root, 'b')));
});

test('readyTasks respects dependencies and retry budget', () => {
  const root = project();
  fl.writeTasksFromPlan(root, 'b', planOutput(root, [T('T1', ['R1']), T('T2', ['R2', 'P1'], ['T1'])]));
  assert.deepEqual(fl.readyTasks(root, 'b').map(t => t.id), ['T1']);
  fl.startAttempt(root, 'b', 'T1', 'br');
  assert.deepEqual(fl.readyTasks(root, 'b').map(t => t.id), []);
  fl.setTask(root, 'b', 'T1', { status: 'passed' });
  assert.deepEqual(fl.readyTasks(root, 'b').map(t => t.id), ['T2']);
});

function verifyOut(root, rows, findings = []) {
  const f = join(root, `ev-${Math.random()}.json`);
  writeFileSync(f, JSON.stringify({ task: 'T1', criteria: rows, findings, verdict: 'pass', verifier: { seat: 'reviewer', adapter: 'fake', model: 'm' } }));
  return f;
}
const row = (id, result = 'pass', tier = 'adversarial') => ({ id, tier, check: `check ${id}`, result, artifact: null });

test('reconcile: all criteria pass → pass; missing row → not_proven (R4); major finding → fail', () => {
  const root = project();
  fl.writeTasksFromPlan(root, 'b', planOutput(root, [T('T1', ['R1', 'R2', 'P1'])]));
  fl.startAttempt(root, 'b', 'T1', 'br'); fl.setTask(root, 'b', 'T1', { status: 'verify' });
  const out = join(root, 'final.json');
  let r = fl.reconcile(root, 'b', 'T1', verifyOut(root, [row('R1'), row('R2')]), [row('mechanical:1', 'pass', 'mechanical')], out);
  assert.equal(r.verdict, 'not_proven');
  const ev = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(ev.criteria.find(c => c.id === 'P1').result, 'not_proven');
  assert.equal(fl.loadTasks(root, 'b').tasks[0].status, 'failed');

  fl.startAttempt(root, 'b', 'T1', 'br'); fl.setTask(root, 'b', 'T1', { status: 'verify' });
  r = fl.reconcile(root, 'b', 'T1', verifyOut(root, [row('R1'), row('R2'), row('P1')], [{ severity: 'major', file: 'a', line: 1, claim: 'race', repro: 'two posts' }]), [], out);
  assert.equal(r.verdict, 'fail');

  fl.startAttempt(root, 'b', 'T1', 'br'); fl.setTask(root, 'b', 'T1', { status: 'verify' });
  r = fl.reconcile(root, 'b', 'T1', verifyOut(root, [row('R1'), row('R2'), row('P1')], [{ severity: 'minor', file: 'a', line: 1, claim: 'naming', repro: 'n/a' }]), [row('mechanical:1', 'pass', 'mechanical')], out);
  assert.equal(r.verdict, 'pass');
  assert.equal(fl.loadTasks(root, 'b').tasks[0].status, 'verify');   // stays until the merge succeeds
  fl.markPassed(root, 'b', 'T1', out);
  assert.equal(fl.loadTasks(root, 'b').tasks[0].status, 'passed');
});

test('reconcile: a failing mechanical row fails the task', () => {
  const root = project();
  fl.writeTasksFromPlan(root, 'b', planOutput(root, [T('T1', ['R1', 'R2', 'P1'])]));
  fl.startAttempt(root, 'b', 'T1', 'br'); fl.setTask(root, 'b', 'T1', { status: 'verify' });
  const r = fl.reconcile(root, 'b', 'T1', verifyOut(root, [row('R1'), row('R2'), row('P1')]), [row('mechanical:1', 'fail', 'mechanical')], join(root, 'f.json'));
  assert.equal(r.verdict, 'fail');
});

test('after max_attempts failures the task is blocked with an escalation and an unblock decision (R5)', () => {
  const root = project();
  fl.writeTasksFromPlan(root, 'b', planOutput(root, [T('T1', ['R1', 'R2', 'P1'])]));
  for (let i = 0; i < 3; i++) {
    fl.startAttempt(root, 'b', 'T1', 'br'); fl.setTask(root, 'b', 'T1', { status: 'verify' });
    fl.reconcile(root, 'b', 'T1', verifyOut(root, [row('R1', 'fail')]), [], join(root, 'f.json'));
  }
  const t = fl.loadTasks(root, 'b').tasks[0];
  assert.equal(t.status, 'blocked');
  assert.match(t.escalation, /3 attempts/);
  assert.deepEqual(fl.readyTasks(root, 'b'), []);
  const d = st.listDecisions(root, 'b', { pending: true }).find(x => x.type === 'unblock');
  assert.equal(d.task, 'T1');
  assert.throws(() => fl.startAttempt(root, 'b', 'T1', 'br'), /blocked/);
});

test('unblock effects: retry with guidance, take over manually, kill task', () => {
  const root = project();
  fl.writeTasksFromPlan(root, 'b', planOutput(root, [T('T1', ['R1', 'R2', 'P1'])]));
  fl.setTask(root, 'b', 'T1', { status: 'blocked', attempts: 3, escalation: 'stuck' });
  let d = fl.ensureDecision(root, 'b', 'unblock', 'T1 blocked', ['retry with guidance', 'take over manually', 'kill task'], { task: 'T1' });
  fl.answer(root, 'b', d.id, 'retry with guidance', { by: 'tester', text: 'use the existing ledger service' });
  let t = fl.loadTasks(root, 'b').tasks[0];
  assert.equal(t.status, 'failed'); assert.equal(t.max_attempts, 4); assert.match(t.escalation, /guidance: use the existing ledger service/);
  fl.setTask(root, 'b', 'T1', { status: 'blocked' });
  d = fl.ensureDecision(root, 'b', 'unblock', 'T1 blocked', ['retry with guidance', 'take over manually', 'kill task'], { task: 'T1' });
  fl.answer(root, 'b', d.id, 'take over manually', { by: 'tester' });
  assert.equal(fl.loadTasks(root, 'b').tasks[0].status, 'verify');
});

test('design approval, ack and gates', () => {
  const root = project();
  assert.equal(fl.designApproved(root, 'b'), false);
  let d = fl.ensureDecision(root, 'b', 'approve_design', 'Approve?', ['approve', 'request changes']);
  fl.answer(root, 'b', d.id, 'request changes', { by: 'tester', text: 'split the migration' });
  assert.equal(fl.designApproved(root, 'b'), false);
  d = fl.ensureDecision(root, 'b', 'approve_design', 'Approve?', ['approve', 'request changes']);
  fl.answer(root, 'b', d.id, 'approve', { by: 'tester' });
  assert.equal(fl.designApproved(root, 'b'), true);
  assert.equal(fl.ackRecorded(root, 'b'), false);
  d = fl.ensureDecision(root, 'b', 'ack_risk', 'paths', ['ack', 'decline']);
  fl.answer(root, 'b', d.id, 'ack', { by: 'tester' });
  assert.equal(fl.ackRecorded(root, 'b'), true);
});

test('acceptance: refused until all tasks pass (R6); approvals respect policy count; delivered on approval', () => {
  const root = project('money');
  fl.writeTasksFromPlan(root, 'b', planOutput(root, [T('T1', ['R1', 'R2', 'P1'])]));
  assert.equal(fl.allPassed(root, 'b'), false);
  assert.throws(() => fl.writeAcceptance(root, 'b', { body: 'x', residual: [], cost: {} }), /not passed: T1/);
  fl.setTask(root, 'b', 'T1', { status: 'passed' });
  for (const s of ['grilling', 'evidence']) st.betTransition(root, 'b', s);
  writeFileSync(join(root, '.bridgie', 'bets', 'b', 'numbers.json'), JSON.stringify({ contribution_per_unit: 3, checks: { unit_positive: true } }));
  st.setFm(st.betPath(root, 'b'), { confidence: 'data' }); st.betTransition(root, 'b', 'signed', { by: 'tester' });
  fl.writeAcceptance(root, 'b', { body: '## Evidence matrix\n', residual: ['no load test'], cost: { usd: 1 } });
  let d = st.listDecisions(root, 'b', { pending: true }).find(x => x.type === 'accept');
  fl.answer(root, 'b', d.id, 'approve', { by: 'anoop', gitSha: 'abc123' });
  let fm = st.readFm(fl.acceptancePath(root, 'b')).data;
  assert.equal(fm.decision, 'pending');                    // money needs 2 approvers by default
  assert.equal(fm.approvals.length, 1);
  d = st.listDecisions(root, 'b', { pending: true }).find(x => x.type === 'accept');
  assert.ok(d, 'a second accept decision is raised');
  assert.throws(() => fl.answer(root, 'b', d.id, 'approve', { by: 'anoop', gitSha: 'abc123' }), /different approver/);
  fl.answer(root, 'b', d.id, 'approve with conditions', { by: 'reviewer2', text: 'flag off until Monday', gitSha: 'abc123' });
  fm = st.readFm(fl.acceptancePath(root, 'b')).data;
  assert.equal(fm.decision, 'approved_with_conditions');
  assert.deepEqual(fm.conditions, ['flag off until Monday']);
  assert.equal(fm.git_sha, 'abc123');
  assert.equal(st.readFm(st.betPath(root, 'b')).data.status, 'delivered');
});

test('acceptance: reject records the reason and leaves the bet signed', () => {
  const root = project('none');
  for (const s of ['grilling', 'evidence']) st.betTransition(root, 'b', s);
  st.betTransition(root, 'b', 'signed', { by: 'tester' });
  fl.writeTasksFromPlan(root, 'b', planOutput(root, [T('T1', ['R1', 'R2', 'P1'])]));
  fl.setTask(root, 'b', 'T1', { status: 'passed' });
  fl.writeAcceptance(root, 'b', { body: 'x', residual: [], cost: {} });
  const d = st.listDecisions(root, 'b', { pending: true }).find(x => x.type === 'accept');
  assert.throws(() => fl.answer(root, 'b', d.id, 'reject', { by: 'tester' }), /reason/);
  fl.answer(root, 'b', d.id, 'reject', { by: 'tester', text: 'missing audit log' });
  assert.equal(st.readFm(fl.acceptancePath(root, 'b')).data.decision, 'rejected');
  assert.equal(st.readFm(st.betPath(root, 'b')).data.status, 'signed');
});

test('writeSpecFiles writes requirements and design from the shaper output', () => {
  const root = project();
  const f = join(root, 'shape.json');
  writeFileSync(f, JSON.stringify({ seat: 'shaper', summary_md: 's', files: { 'requirements.md': '## R1 · event\nWHEN a THE SYSTEM SHALL b\n', 'design.md': '# Design\n' } }));
  assert.deepEqual(fl.writeSpecFiles(root, 'b', f).ids, ['R1']);
  writeFileSync(f, JSON.stringify({ seat: 'shaper', summary_md: 's', files: { 'requirements.md': 'no headings', 'design.md': 'd' } }));
  assert.throws(() => fl.writeSpecFiles(root, 'b', f), /no "## R<n>"/);
});

test('writeSpecFiles applies a revision sent as edits to the files already there', () => {
  const root = project();
  const f = join(root, 'shape.json');
  const out = o => writeFileSync(f, JSON.stringify({ seat: 'shaper', summary_md: 's', ...o }));
  out({ edits: { 'design.md': [{ old: 'x', new: 'y' }] }, files: { 'requirements.md': '## R1 · event\nWHEN a THE SYSTEM SHALL b\n' } });
  assert.throws(() => fl.writeSpecFiles(root, 'b', f), /does not exist yet/);
  out({ files: { 'requirements.md': '## R1 · event\nWHEN a THE SYSTEM SHALL b\n', 'design.md': '# Design\n\nOption A wins.\nRollback: flag.\n' } });
  fl.writeSpecFiles(root, 'b', f);
  out({ edits: { 'design.md': [{ old: 'Option A wins.', new: 'Option B wins.' }],
                 'requirements.md': [{ old: '## R1 · event\nWHEN a THE SYSTEM SHALL b\n', new: '## R1 · event\nWHEN a THE SYSTEM SHALL b\n\n## R2 · event\nWHEN c THE SYSTEM SHALL d\n' }] } });
  assert.deepEqual(fl.writeSpecFiles(root, 'b', f).ids, ['R1', 'R2']);
  const dir = join(root, '.bridgie', 'specs', 'b');
  assert.equal(readFileSync(join(dir, 'design.md'), 'utf8'), '# Design\n\nOption B wins.\nRollback: flag.\n');
  out({ edits: { 'design.md': [{ old: 'not there', new: 'z' }] } });
  assert.throws(() => fl.writeSpecFiles(root, 'b', f), /old text not found in design\.md/);
  out({ edits: { 'design.md': [{ old: 'o', new: 'z' }] } });
  assert.throws(() => fl.writeSpecFiles(root, 'b', f), /more than once/);
  out({ edits: { 'design.md': [{ old: '', new: 'z' }] } });
  assert.throws(() => fl.writeSpecFiles(root, 'b', f));
  assert.equal(readFileSync(join(dir, 'design.md'), 'utf8'), '# Design\n\nOption B wins.\nRollback: flag.\n');  // a refused revision changes nothing
});

test('failAttempt fails, then blocks on the last attempt with an unblock decision', () => {
  const root = project();
  fl.writeTasksFromPlan(root, 'b', planOutput(root, [T('T1', ['R1', 'R2', 'P1'])]));
  fl.startAttempt(root, 'b', 'T1', 'br');
  assert.equal(fl.failAttempt(root, 'b', 'T1', 'adapter exited 1').status, 'failed');
  fl.startAttempt(root, 'b', 'T1', 'br'); fl.startAttempt(root, 'b', 'T1', 'br');
  assert.equal(fl.failAttempt(root, 'b', 'T1', 'edited .bridgie/').status, 'blocked');
  assert.ok(st.listDecisions(root, 'b', { pending: true }).some(d => d.type === 'unblock' && d.task === 'T1'));
});

test('globToRegex and riskOfPaths pick the highest matching risk and whether an ack is needed', () => {
  assert.ok(fl.globToRegex('**/Modules/Payments/**').test('src/Services/FSM/Modules/Payments/Charge.cs'));
  assert.ok(fl.globToRegex('terraform/**').test('terraform/main.tf'));
  assert.ok(!fl.globToRegex('terraform/**').test('src/terraform.md'));
  const root = project('none', 'version: 1\nlanes:\n  engineering:\n    risk_paths:\n      - { glob: "src/ledger/**", risk: money }\n');
  let r = fl.riskOfPaths(root, 'b', ['README.md', 'src/app.ts']);
  assert.equal(r.risk, 'none'); assert.equal(r.needs_ack, false);
  r = fl.riskOfPaths(root, 'b', ['terraform/main.tf', 'src/ledger/post.ts']);
  assert.equal(r.risk, 'money'); assert.equal(r.needs_ack, true);
  assert.deepEqual(r.paths, ['terraform/main.tf (infra)', 'src/ledger/post.ts (money)']);
});

test('mechanicalPlan: project commands win; else lane commands for detected stacks, limited to policy tiers', () => {
  const root = project('none', 'version: 1\nverify:\n  commands:\n    mechanical: ["npm test"]\n    contracts: ["never runs"]\n');
  const wt = mkdtempSync(join(tmpdir(), 'wt-'));
  // contracts is not required at risk none; specified is required and has no command → missing
  assert.deepEqual(fl.mechanicalPlan(root, 'b', wt), [{ tier: 'mechanical', cmd: 'npm test' }, { tier: 'specified', cmd: null, missing: true }]);
  const root2 = project('none');
  writeFileSync(join(wt, 'package.json'), '{}');
  assert.deepEqual(fl.mechanicalPlan(root2, 'b', wt).map(x => x.cmd), ['npm run lint --if-present', 'npm run build --if-present', 'npx vitest run']);
  assert.deepEqual(fl.mechanicalPlan(root2, 'b', mkdtempSync(join(tmpdir(), 'empty-'))).map(x => `${x.tier}:${x.missing}`), ['mechanical:true', 'specified:true']);
});

test('recoverAttempts: a task a dead run left in_progress is buildable again and the attempt is not counted', () => {
  const root = project();
  fl.writeTasksFromPlan(root, 'b', planOutput(root, [T('T1', ['R1']), T('T2', ['R2', 'P1'], ['T1'])]));
  fl.startAttempt(root, 'b', 'T1', 'bridgie-task/b/T1');
  assert.equal(fl.getTask(fl.loadTasks(root, 'b'), 'T1').status, 'in_progress');
  assert.deepEqual(fl.readyTasks(root, 'b'), []);
  // a live lock: nothing is recovered while an agent runs
  mkdirSync(join(root, '.bridgie', '.seat-lock'));
  writeFileSync(join(root, '.bridgie', '.seat-lock', 'owner.json'), JSON.stringify({ seat: 'implementer', run_dir: 'x', since: new Date().toISOString(), pid: process.pid }));
  assert.deepEqual(fl.recoverAttempts(root, 'b'), []);
  // the same lock from a process that is gone is stale at once
  writeFileSync(join(root, '.bridgie', '.seat-lock', 'owner.json'), JSON.stringify({ seat: 'implementer', run_dir: 'x', since: new Date().toISOString(), pid: 2 ** 22 + 12345 }));
  assert.equal(st.seatLock(root), null);
  assert.deepEqual(fl.recoverAttempts(root, 'b'), ['T1']);
  const t = fl.getTask(fl.loadTasks(root, 'b'), 'T1');
  assert.equal(t.status, 'todo'); assert.equal(t.attempts, 0); assert.match(t.escalation, /interrupted/);
  assert.deepEqual(fl.readyTasks(root, 'b').map(x => x.id), ['T1']);
  // a second attempt that dies leaves the first failure counted
  fl.startAttempt(root, 'b', 'T1', 'bridgie-task/b/T1'); fl.failAttempt(root, 'b', 'T1', 'boom');
  fl.startAttempt(root, 'b', 'T1', 'bridgie-task/b/T1');
  assert.deepEqual(fl.recoverAttempts(root, 'b'), ['T1']);
  const again = fl.getTask(fl.loadTasks(root, 'b'), 'T1');
  assert.equal(again.status, 'failed'); assert.equal(again.attempts, 1);
});

test('a lock from another machine keeps the time rule: its pid says nothing here', () => {
  const root = project();
  mkdirSync(join(root, '.bridgie', '.seat-lock'));
  writeFileSync(join(root, '.bridgie', '.seat-lock', 'owner.json'), JSON.stringify({ seat: 's', run_dir: 'x', since: new Date().toISOString(), pid: 2 ** 22 + 12345, host: 'another-machine' }));
  assert.equal(st.seatLock(root).seat, 's');
});

test('taskProfile: size sets the extras and risk sets the floor', () => {
  const root = project('money', "version: 1\nverify:\n  commands:\n    mechanical: ['m']\n    specified: ['s']\n    contracts: ['c']\n    invariants: ['i']\n    behavioural: ['b']\n    dual_run: ['d']\n");
  fl.writeTasksFromPlan(root, 'b', planOutput(root, [
    { ...T('T1', ['R1']), size: 'small' }, { ...T('T2', ['R2', 'P1'], ['T1']), size: 'small' },
    T('T3', ['R1'], ['T1']), { ...T('T4', ['R1'], ['T1']), size: 'large' }, { ...T('T5', ['R1'], ['T1']), size: 'enormous' }]));
  const doc = fl.loadTasks(root, 'b');
  assert.equal(fl.getTask(doc, 'T1').size, 'small');
  assert.equal(fl.getTask(doc, 'T3').size, undefined);          // none given
  assert.equal(fl.getTask(doc, 'T5').size, undefined);          // not a size: dropped, so medium
  // small and nothing risky: no hardener, the whole-system tiers dropped
  assert.deepEqual(fl.taskProfile(root, 'b', 'T1'), { planned: 'small', size: 'small', reason: null, harden: false, skip_tiers: ['behavioural', 'dual_run'] });
  // planned small, but it builds a requirement tagged money: medium, whatever the plan said
  const t2 = fl.taskProfile(root, 'b', 'T2');
  assert.equal(t2.size, 'medium'); assert.match(t2.reason, /R2, tagged risk money/); assert.deepEqual(t2.skip_tiers, []); assert.equal(t2.harden, undefined);
  assert.equal(fl.taskProfile(root, 'b', 'T3').size, 'medium');
  assert.equal(fl.taskProfile(root, 'b', 'T4').harden, true);
  // small, but its diff changes a risk path: medium once the files are known
  const paid = fl.taskProfile(root, 'b', 'T1', ['src/Billing/charge.js']);
  assert.equal(paid.size, 'medium'); assert.match(paid.reason, /src\/Billing\/charge\.js/);
  assert.equal(fl.taskProfile(root, 'b', 'T1', ['docs/readme.md']).size, 'small');
  // the tiers a small task drops; lint, build and tests are never dropped
  const tiers = skip => fl.mechanicalPlan(root, 'b', root, skip).map(x => x.tier);
  assert.deepEqual(tiers([]), ['mechanical', 'specified', 'contracts', 'invariants', 'behavioural', 'dual_run']);
  assert.deepEqual(tiers(['behavioural', 'dual_run']), ['mechanical', 'specified', 'contracts', 'invariants']);
  assert.deepEqual(tiers(['mechanical', 'specified', 'invariants']), ['mechanical', 'specified', 'contracts', 'behavioural', 'dual_run']);
});

test('taskProfile follows the project policy: the floor and what small drops', () => {
  const root = project('money', 'version: 1\nsizes:\n  floor_risk: security\n  small: { harden: false, skip_tiers: [dual_run] }\n');
  fl.writeTasksFromPlan(root, 'b', planOutput(root, [{ ...T('T1', ['R1', 'R2', 'P1']), size: 'small' }]));
  // money is above security in the risk order, so R2 still lifts it
  assert.equal(fl.taskProfile(root, 'b', 'T1').size, 'medium');
  const low = project('none', 'version: 1\nsizes:\n  small: { harden: false, skip_tiers: [dual_run] }\n');
  writeFileSync(join(low, '.bridgie', 'specs', 'b', 'requirements.md'), '# R\n\n## R1 · event · risk: ux\nWHEN a THE SYSTEM SHALL b\n');
  fl.writeTasksFromPlan(low, 'b', planOutput(low, [{ ...T('T1', ['R1']), size: 'small' }]));
  assert.deepEqual(fl.taskProfile(low, 'b', 'T1').skip_tiers, ['dual_run']);   // ux is below the floor (data)
});

function blockedByReview(root, mechanical = [row('mechanical:1', 'pass', 'mechanical')]) {
  fl.writeTasksFromPlan(root, 'b', planOutput(root, [T('T1', ['R1', 'R2', 'P1'])]));
  const dir = join(root, '.bridgie', 'runs', 'b', 'verify-03'); mkdirSync(dir, { recursive: true });
  const out = join(dir, 'evidence.json');
  writeFileSync(join(dir, 'mechanical-key.json'), JSON.stringify({ task: 'T1', sha: 'abc123', plan: 'p' }));
  for (let i = 0; i < 3; i++) {
    fl.startAttempt(root, 'b', 'T1', 'br'); fl.setTask(root, 'b', 'T1', { status: 'verify' });
    fl.reconcile(root, 'b', 'T1', verifyOut(root, [row('R1'), row('R2', 'not_proven'), row('P1')], [
      { severity: 'major', file: 'src/a.py', line: 7, claim: 'a save can race another window', repro: 'two posts' },
      { severity: 'minor', file: 'src/a.py', line: 9, claim: 'naming', repro: 'n/a' }]), mechanical, out);
  }
  return st.loadDecisions(root, 'b').decisions.find(d => d.type === 'unblock' && d.status !== 'answered');
}

test('a task blocked by the reviewer alone can be accepted with its findings as known limitations', () => {
  const root = project();
  const d = blockedByReview(root);
  assert.equal(fl.loadTasks(root, 'b').tasks[0].status, 'blocked');
  assert.ok(d.options.includes('accept as limitations'));
  // a reason is required
  assert.throws(() => fl.answer(root, 'b', d.id, 'accept as limitations', { by: 'Ann' }), /needs the reason/);
  const done = fl.answer(root, 'b', d.id, 'accept as limitations', { by: 'Ann', text: 'one window at a time in practice' });
  assert.match(done.effect, /1 finding\(s\) and 1 unproven row\(s\) accepted as known limitations by Ann/);
  const t = fl.loadTasks(root, 'b').tasks[0];
  assert.equal(t.status, 'verify');                      // verify re-checks the tiers and merges
  assert.equal(t.accepted.sha, 'abc123');                // bound to the commit that was reviewed
  assert.deepEqual(t.accepted.findings, [{ severity: 'major', claim: 'a save can race another window', file: 'src/a.py', line: 7 }]);
  assert.deepEqual(t.accepted.criteria.map(c => c.id), ['R2']);
  // later reviewers and the acceptance package see it
  assert.match(fl.limitationsText(root, 'b'), /T1: accepted by Ann[\s\S]*Reason: one window at a time in practice[\s\S]*major: a save can race another window \(src\/a\.py:7\)[\s\S]*R2 not_proven/);
  fl.markPassed(root, 'b', 'T1', t.evidence);
  assert.match(fl.acceptancePacket(root, 'b').md, /## Accepted limitations[\s\S]*a save can race another window/);
});

test('findings cannot be accepted over a failing tier, and a build failure offers no such option', () => {
  const root = project();
  const d = blockedByReview(root, [row('specified:1', 'fail', 'specified')]);
  assert.ok(!d.options.includes('accept as limitations'));
  assert.throws(() => fl.acceptLimitations(root, 'b', 'T1', { by: 'Ann', text: 'r' }), /failing tiers \(specified:1\); a limitation cannot cover a failing check/);
  const other = project();
  fl.writeTasksFromPlan(other, 'b', planOutput(other, [T('T1', ['R1', 'R2', 'P1'])]));
  for (let i = 0; i < 3; i++) { fl.startAttempt(other, 'b', 'T1', 'br'); fl.failAttempt(other, 'b', 'T1', 'boom'); }
  assert.ok(!st.loadDecisions(other, 'b').decisions.find(x => x.type === 'unblock').options.includes('accept as limitations'));
});

test('reviewDebt lists passed tasks reviewed by their producer\'s own family until a second-family review', () => {
  const root = project();
  fl.writeTasksFromPlan(root, 'b', planOutput(root, [T('T1', ['R1']), T('T2', ['R2'], ['T1']), T('T3', ['P1'], ['T1']), T('T4', ['R1'], ['T1'])]));
  fl.setTask(root, 'b', 'T1', { status: 'passed', review: { adapter: 'claude-code', vendor: 'anthropic', producer_vendor: 'anthropic', cross_family: false } });
  fl.setTask(root, 'b', 'T2', { status: 'passed', review: { adapter: 'codex', vendor: 'openai', producer_vendor: 'anthropic', cross_family: true } });
  fl.setTask(root, 'b', 'T3', { status: 'passed' });   // passed before reviews were recorded
  assert.deepEqual(fl.reviewDebt(root, 'b'), { same: ['T1'], unknown: ['T3'] });
  assert.match(fl.acceptancePacket(root, 'b').md, /## Review debt[\s\S]*T1 \(bridgie rereview b\)/);
  fl.setTask(root, 'b', 'T1', { review: { adapter: 'claude-code', vendor: 'anthropic', producer_vendor: 'anthropic', cross_family: false, rereview: { adapter: 'antigravity', vendor: 'google', cross_family: true, verdict: 'pass' } } });
  assert.deepEqual(fl.reviewDebt(root, 'b').same, []);
});

// ---------- governance ----------
function signedMoney(policy = 'version: 1\n') {
  const root = project('money', policy);
  for (const s of ['grilling', 'evidence']) st.betTransition(root, 'b', s);
  writeFileSync(join(root, '.bridgie', 'bets', 'b', 'numbers.json'), JSON.stringify({ contribution_per_unit: 3, checks: { unit_positive: true } }));
  st.setFm(st.betPath(root, 'b'), { confidence: 'data' }); st.betTransition(root, 'b', 'signed', { by: 'tester' });
  fl.writeTasksFromPlan(root, 'b', planOutput(root, [T('T1', ['R1', 'R2', 'P1'])]));
  fl.setTask(root, 'b', 'T1', { status: 'passed' });
  return root;
}
const agentCli = (agent, extra = {}) => ({ channel: 'cli', agent, os_user: 'u', host: 'h', ...extra });

test('provenance: an answer records through what it arrived, and the decision log says so', () => {
  const root = project();
  const d = fl.ensureDecision(root, 'b', 'question', 'Who pays?', ['yes', 'no']);
  const res = fl.answer(root, 'b', d.id, 'yes', { by: 'tester', via: agentCli('claude-code') });
  assert.deepEqual(res.via, { channel: 'cli', agent: 'claude-code', os_user: 'u', host: 'h' });
  assert.match(readFileSync(st.betPath(root, 'b'), 'utf8'), /yes → recorded \[tester through claude-code\]/);
  const saved = st.loadDecisions(root, 'b').decisions.find(x => x.id === d.id);
  assert.equal(saved.via.agent, 'claude-code');
});

test('humans-only: an agent command line cannot answer an acceptance unless it says it relays a person', () => {
  const root = signedMoney();
  fl.writeAcceptance(root, 'b', { body: 'x', residual: [], cost: {} });
  const d = st.listDecisions(root, 'b', { pending: true }).find(x => x.type === 'accept');
  assert.throws(() => fl.answer(root, 'b', d.id, 'approve', { by: 'tester', via: agentCli('claude-code') }), /is for a person.*inside an agent \(claude-code\).*--relayed/);
  assert.equal(st.readFm(fl.acceptancePath(root, 'b')).data.approvals.length, 0, 'a refused answer changes nothing');
  fl.answer(root, 'b', d.id, 'approve', { by: 'tester', via: agentCli('claude-code', { relayed: true }) });
  const fm = st.readFm(fl.acceptancePath(root, 'b')).data;
  assert.equal(fm.approvals[0].via.agent, 'claude-code');
  assert.equal(fm.approvals[0].via.relayed, true);
  assert.match(readFileSync(st.betPath(root, 'b'), 'utf8'), /\[tester through claude-code \(relayed\)\]/);
});

test('humans-only: relay off refuses the agent outright; a person and the surface are not refused', () => {
  const root = signedMoney('version: 1\nhumans_only: { decisions: [accept], relay: false }\n');
  fl.writeAcceptance(root, 'b', { body: 'x', residual: [], cost: {} });
  let d = st.listDecisions(root, 'b', { pending: true }).find(x => x.type === 'accept');
  assert.throws(() => fl.answer(root, 'b', d.id, 'approve', { by: 'tester', via: agentCli('codex', { relayed: true }) }), /is for a person.*own terminal/);
  fl.answer(root, 'b', d.id, 'approve', { by: 'tester', via: agentCli(null) });            // a person's terminal
  d = st.listDecisions(root, 'b', { pending: true }).find(x => x.type === 'accept');
  fl.answer(root, 'b', d.id, 'approve', { by: 'second', via: { channel: 'surface', agent: 'claude-code', os_user: 'u', host: 'h' } });   // clicked on the page
  assert.equal(st.readFm(fl.acceptancePath(root, 'b')).data.decision, 'approved');
  // deferring is never refused: it decides nothing
  const q = fl.ensureDecision(root, 'b', 'governance', 'x', ['accept the change', 'keep the signed rules']);
  fl.answer(root, 'b', q.id, 'defer', { by: 'tester', via: agentCli('codex') });
});

test('governance: signing records the rules; only weaker rules are drift', () => {
  const root = signedMoney();
  const signed = st.readFm(st.betPath(root, 'b')).data.governance.rules;
  assert.equal(signed.approvers, 2);
  assert.equal(signed.cross_family, true);
  assert.ok(signed.tiers.includes('dual_run'));
  assert.deepEqual(signed.humans_only, ['accept', 'governance']);
  assert.deepEqual(fl.governanceDrift(root, 'b'), []);
  const weak = { ...signed, tiers: signed.tiers.filter(t => t !== 'dual_run'), approvers: 1, cross_family: false, auto_accept: true, human_ack_before_build: false,
    humans_only: ['governance'], owner_override: true, floor_risk: 'money', commands: 'abc',
    sizes: { ...signed.sizes, small: { harden: false, skip_tiers: ['adversarial', 'behavioural', 'dual_run'] }, large: { harden: null, skip_tiers: [] } } };
  const drift = st.governanceDrift({ ...signed, relay: false, owner_override: false }, { ...weak, relay: true });
  for (const want of [/dual_run tier is no longer required/, /approvers required went from 2 to 1/, /another model family is no longer required/, /auto-accept was turned on/,
    /risk acknowledgement before build was removed/, /"accept" decisions no longer need a person/, /agents may now relay/, /owner override at acceptance was turned on/,
    /risk floor for small tasks rose from data to money/, /small tasks now skip adversarial/, /large tasks are no longer always hardened/, /verify commands in policy\.yaml changed/]) {
    assert.ok(drift.some(x => want.test(x)), `${want} in ${JSON.stringify(drift)}`);
  }
  // stronger rules are not drift
  const strong = { ...signed, tiers: [...signed.tiers, 'extra'], approvers: 3, humans_only: [...signed.humans_only, 'sign'], relay: false, owner_override: false };
  assert.deepEqual(st.governanceDrift(signed, strong), []);
});

test('governance: a weakened policy stops the bet until the owner decides; keeping the signed rules raises no second decision', () => {
  const root = signedMoney();
  assert.equal(fl.governanceGate(root, 'b'), null);
  writeFileSync(join(root, '.bridgie', 'policy.yaml'), 'version: 1\nlanes:\n  engineering:\n    cross_family: false\n    by_risk:\n      money: { approvers: 1 }\n');
  const gate = fl.governanceGate(root, 'b');
  assert.equal(gate.kept, false);
  assert.equal(gate.drift.length, 2);
  const d = st.loadDecisions(root, 'b').decisions.find(x => x.id === gate.decision);
  assert.equal(d.type, 'governance');
  assert.match(d.context, /approvers required went from 2 to 1; a reviewer from another model family is no longer required|another model family is no longer required/);
  assert.equal(fl.governanceGate(root, 'b').decision, gate.decision, 'the same pending decision, not a new one');
  // an approval cannot slip through while the rules are weaker
  fl.writeAcceptance(root, 'b', { body: 'x', residual: [], cost: {} });
  const acc = st.listDecisions(root, 'b', { pending: true }).find(x => x.type === 'accept');
  assert.throws(() => fl.answer(root, 'b', acc.id, 'approve', { by: 'tester' }), /policy is weaker than the rules "b" was signed under/);
  fl.answer(root, 'b', gate.decision, 'keep the signed rules', { by: 'tester' });
  const kept = fl.governanceGate(root, 'b');
  assert.equal(kept.kept, true);
  assert.equal(kept.decision, gate.decision);
  assert.equal(st.loadDecisions(root, 'b').decisions.filter(x => x.type === 'governance').length, 1);
  // putting the policy back clears it
  writeFileSync(join(root, '.bridgie', 'policy.yaml'), 'version: 1\n');
  assert.equal(fl.governanceGate(root, 'b'), null);
});

test('governance: only the owner can move the bet to weaker rules; then the bet is held to them', () => {
  const root = signedMoney();
  writeFileSync(join(root, '.bridgie', 'policy.yaml'), 'version: 1\nlanes:\n  engineering:\n    by_risk:\n      money: { approvers: 1 }\n');
  const gate = fl.governanceGate(root, 'b');
  assert.throws(() => fl.answer(root, 'b', gate.decision, 'accept the change', { by: 'someone-else' }), /only the owner "tester"/);
  fl.answer(root, 'b', gate.decision, 'accept the change', { by: 'tester' });
  const g = st.readFm(st.betPath(root, 'b')).data.governance;
  assert.equal(g.rules.approvers, 1);
  assert.equal(g.accepted_by, 'tester');
  assert.equal(fl.governanceGate(root, 'b'), null);
});

test('owner override: the owner delivers with fewer approvals and the record says so; policy can forbid it', () => {
  let root = signedMoney();
  fl.writeAcceptance(root, 'b', { body: 'x', residual: [], cost: {} });
  let d = st.listDecisions(root, 'b', { pending: true }).find(x => x.type === 'accept');
  assert.throws(() => fl.answer(root, 'b', d.id, 'approve', { by: 'second', override: 'in a hurry' }), /only the owner "tester" can override/);
  const res = fl.answer(root, 'b', d.id, 'approve', { by: 'tester', override: 'solo founder: there is no second approver' });
  assert.match(res.effect, /approved by owner override with 1 of 2 approvals \(solo founder/);
  const fm = st.readFm(fl.acceptancePath(root, 'b')).data;
  assert.equal(fm.decision, 'approved');
  assert.equal(fm.override.by, 'tester');
  assert.equal(fm.override.approvals, 1);
  assert.equal(fm.override.required, 2);
  assert.equal(fm.override.reason, 'solo founder: there is no second approver');
  assert.equal(st.readFm(st.betPath(root, 'b')).data.status, 'delivered');
  assert.equal(st.listDecisions(root, 'b', { pending: true }).filter(x => x.type === 'accept').length, 0, 'no further approval is asked for');

  // after a first ordinary approval the owner can still override, without approving twice
  root = signedMoney();
  fl.writeAcceptance(root, 'b', { body: 'x', residual: [], cost: {} });
  d = st.listDecisions(root, 'b', { pending: true }).find(x => x.type === 'accept');
  fl.answer(root, 'b', d.id, 'approve', { by: 'tester' });
  d = st.listDecisions(root, 'b', { pending: true }).find(x => x.type === 'accept');
  fl.answer(root, 'b', d.id, 'approve', { by: 'tester', override: 'second approver is away' });
  assert.equal(st.readFm(fl.acceptancePath(root, 'b')).data.approvals.length, 1);

  root = signedMoney('version: 1\nacceptance: { owner_override: false }\n');
  fl.writeAcceptance(root, 'b', { body: 'x', residual: [], cost: {} });
  d = st.listDecisions(root, 'b', { pending: true }).find(x => x.type === 'accept');
  assert.throws(() => fl.answer(root, 'b', d.id, 'approve', { by: 'tester', override: 'x' }), /policy does not allow an owner override/);
});

// ---------- plan checks, cost ----------
test('planWarnings: a requirement that names one built by a task it does not depend on is flagged; the cycle case says so', () => {
  const root = project();
  writeFileSync(join(root, '.bridgie', 'specs', 'b', 'requirements.md'),
    '# Requirements\n\n## R1 · event · risk: none\nWHEN a THE SYSTEM SHALL b as R2 defines.\n\n## R2 · event · risk: none\nWHEN c THE SYSTEM SHALL d, shown beside R1.\n\n## R3 · event · risk: none\nWHEN e THE SYSTEM SHALL f.\n\n## P1 · property\nFor any x, y SHALL hold.\nValidates: R3\n');
  // T2 depends on T1, but T1's requirement needs T2's: no order can verify T1 first
  fl.writeTasksFromPlan(root, 'b', planOutput(root, [T('T1', ['R1']), T('T2', ['R2'], ['T1']), T('T3', ['R3']), T('T4', ['P1'])]));
  const w = fl.planWarnings(root, 'b');
  assert.equal(w.length, 2);
  assert.match(w[0], /^T1 builds R1, whose text refers to R2, but R2 is built by T2, which depends on T1: T1 cannot be verified against R2 until T2 exists\. Build R1 and R2 in one task/);
  assert.match(w[1], /^T4 builds P1, whose text refers to R3, but R3 is built by T3, which T4 does not depend on: add T3 to T4's depends_on/);
  // ordered through a transitive dependency, or built together: nothing to say
  fl.writeTasksFromPlan(root, 'b', planOutput(root, [T('T1', ['R1', 'R2']), T('T3', ['R3'], ['T1']), T('T4', ['P1'], ['T3'])]));
  assert.deepEqual(fl.planWarnings(root, 'b'), []);
  const root2 = project();                             // the standard fixture: P1 validates R2, both in one task
  fl.writeTasksFromPlan(root2, 'b', planOutput(root2, [T('T1', ['R1']), T('T2', ['R2', 'P1'], ['T1'])]));
  assert.deepEqual(fl.planWarnings(root2, 'b'), []);
});

test('costByTask: time per task split into build, review and checks; old runs are placed by their claim or evidence', () => {
  const root = project();
  fl.writeTasksFromPlan(root, 'b', planOutput(root, [{ ...T('T1', ['R1']), size: 'small' }, T('T2', ['R2', 'P1'], ['T1'])]));
  fl.setTask(root, 'b', 'T1', { status: 'passed', attempts: 2 });
  const run = (name, entries, extra = {}) => {
    const d = join(st.runsDir(root, 'b'), name); mkdirSync(d, { recursive: true });
    for (const e of entries) st.costAdd(d, { adapter: 'fake', model: 'default', started_at: '2026-01-01T00:00:00Z', attempt: 1, exit_code: 0, tokens_in: null, tokens_out: null, usd: null, ...e });
    for (const [f, v] of Object.entries(extra)) writeFileSync(join(d, f), JSON.stringify(v));
  };
  run('shaper-01', [{ seat: 'shaper', duration_s: 100 }]);
  run('implementer-01', [{ seat: 'implementer', task: 'T1', duration_s: 600 }]);
  run('implementer-02', [{ seat: 'implementer', duration_s: 300 }], { 'claim.json': { task: 'T1' } });       // written before entries named the task
  run('verify-01', [{ seat: 'tiers', task: 'T1', duration_s: 90 }]);
  run('reviewer-01', [{ seat: 'reviewer', duration_s: 240, usd: 0.5 }], { 'evidence.json': { task: 'T1' } });
  run('hardener-01', [{ seat: 'hardener', task: 'T9', duration_s: 50 }]);                                    // a task a re-plan removed
  const rows = fl.costByTask(root, 'b');
  const t1 = rows.find(r => r.task === 'T1');
  assert.deepEqual({ runs: t1.runs, build: t1.build, review: t1.review, checks: t1.checks, seconds: t1.seconds, attempts: t1.attempts, size: t1.size, usd: t1.usd },
    { runs: 4, build: 900, review: 240, checks: 90, seconds: 1230, attempts: 2, size: 'small', usd: 0.5 });
  assert.equal(t1.tokens, null);
  assert.equal(t1.unreported, 2, 'the two implementer runs said nothing about usage; the tiers are not model runs');
  assert.equal(rows.find(r => r.task === 'T2').runs, 0);
  assert.equal(rows.find(r => r.task === '(bet)').other, 100);
  assert.equal(rows.find(r => r.task === 'T9').title, 'not in the current plan');
  const table = fl.costTable(rows).split('\n');
  assert.match(table[0], /^Task\s+Size\s+Status\s+Attempts\s+Runs\s+Build\s+Review\s+Checks\s+Other\s+Total\s+Cost$/);
  assert.match(table[1], /^T1\s+small\s+passed\s+2\s+4\s+15m\s+4m\s+2m\s+0s\s+21m\s+\$0\.50$/);     // the costliest task first
  assert.match(table.at(-1), /^6 runs, 23m of agent and check time; \$0\.50 at list price \(\$0\.50 per passed task, everything included\)\. 4 model run\(s\) reported no usage, so the real figures are higher\. Cost is what the CLI computed from list prices: on a subscription it is not a bill$/);
});

test('mechanicalPlan: a Python project gets compile and pytest commands from the lane', () => {
  const root = project('none');
  const wt = mkdtempSync(join(tmpdir(), 'wt-'));
  writeFileSync(join(wt, 'pyproject.toml'), '[project]\nname = "x"\n');
  const py = process.platform === 'win32' ? 'python' : 'python3';
  const plan = fl.mechanicalPlan(root, 'b', wt);
  assert.deepEqual(plan.map(x => x.tier), ['mechanical', 'specified']);
  assert.ok(plan[0].cmd.startsWith(`${py} -m compileall -q -x `));
  assert.equal(plan[1].cmd, `${py} -m pytest -q`);
});

// ---------- parallel builds ----------
test('pickBatch: ready tasks up to the width; a task whose declared files overlap one already picked waits', () => {
  const root = project();
  const tk = (id, reqs, touches, deps = []) => ({ ...T(id, reqs, deps), ...(touches ? { touches } : {}) });
  fl.writeTasksFromPlan(root, 'b', planOutput(root, [
    tk('T1', ['R1'], ['src/pay/refund.py', 'tests/pay/**']), tk('T2', ['R2'], ['src/pay/refund.py']), tk('T3', ['P1'], ['src/ledger/**']),
    tk('T4', ['R1'], null), tk('T5', ['R1'], ['docs/**'], ['T1']),
  ]));
  assert.deepEqual(fl.loadTasks(root, 'b').tasks[0].touches, ['src/pay/refund.py', 'tests/pay/**']);
  assert.deepEqual(fl.pickBatch(root, 'b', 1), { batch: ['T1'], held: [] });
  const three = fl.pickBatch(root, 'b', 3);
  assert.deepEqual(three.batch, ['T1', 'T3', 'T4']);         // T2 shares a file with T1; T4 declares nothing; T5 waits on T1
  assert.deepEqual(three.held, [{ task: 'T2', with: 'T1', paths: ['src/pay/refund.py', 'src/pay/refund.py'] }]);
  assert.deepEqual(fl.pickBatch(root, 'b', 8).batch, ['T1', 'T3', 'T4']);
  // patterns err towards overlap: a leading wildcard could be anywhere
  assert.ok(fl.touchesOverlap(['**/conftest.py'], ['src/x.py']));
  assert.ok(fl.touchesOverlap(['src/pay/**'], ['src/pay/refund.py']));
  assert.equal(fl.touchesOverlap(['src/pay/**'], ['src/ledger/**']), null);
  assert.equal(fl.touchesOverlap(undefined, ['src/x.py']), null);
});

test('unstartAttempt: an attempt that never ran is not counted', () => {
  const root = project();
  fl.writeTasksFromPlan(root, 'b', planOutput(root, [T('T1', ['R1', 'R2', 'P1'])]));
  fl.startAttempt(root, 'b', 'T1', 'bridgie-task/b/T1');
  let t = fl.unstartAttempt(root, 'b', 'T1', 'a model CLI was at its usage limit');
  assert.deepEqual({ attempts: t.attempts, status: t.status }, { attempts: 0, status: 'todo' });
  assert.match(t.escalation, /usage limit/);
  fl.startAttempt(root, 'b', 'T1', 'x'); fl.failAttempt(root, 'b', 'T1', 'bad'); fl.startAttempt(root, 'b', 'T1', 'x');
  t = fl.unstartAttempt(root, 'b', 'T1');
  assert.deepEqual({ attempts: t.attempts, status: t.status }, { attempts: 1, status: 'failed' });
  assert.equal(fl.unstartAttempt(root, 'b', 'T1').attempts, 1, 'only an attempt in progress is undone');
});

test('cost: tokens and money are summed per task from what each CLI reported; cost per passed task counts everything', () => {
  const root = project();
  fl.writeTasksFromPlan(root, 'b', planOutput(root, [T('T1', ['R1']), T('T2', ['R2', 'P1'])]));
  fl.setTask(root, 'b', 'T1', { status: 'passed', attempts: 1 });
  fl.setTask(root, 'b', 'T2', { status: 'failed', attempts: 2 });
  const run = (name, e) => { const d = join(st.runsDir(root, 'b'), name); mkdirSync(d, { recursive: true }); st.costAdd(d, { adapter: 'x', model: 'm', started_at: '2026-01-01T00:00:00Z', attempt: 1, duration_s: 60, ...e }); };
  run('implementer-01', { seat: 'implementer', task: 'T1', tokens_in: 1000, tokens_out: 500, tokens_cache_read: 200000, tokens_cache_write: 30000, tokens_total: 231500, usd: 1.25 });
  run('reviewer-01', { seat: 'reviewer', task: 'T1', tokens_total: 68485, usd: null });         // a CLI that reports a total and no cost
  run('implementer-02', { seat: 'implementer', task: 'T2', tokens_in: 10, tokens_out: 20, usd: 0.75 });   // no total given: the parts are summed
  run('shaper-01', { seat: 'shaper', tokens_in: null, tokens_out: null, usd: null });
  const rows = fl.costByTask(root, 'b');
  assert.equal(rows.find(r => r.task === 'T1').tokens, 299985);
  assert.equal(rows.find(r => r.task === 'T1').usd, 1.25);
  assert.equal(rows.find(r => r.task === 'T2').tokens, 30);
  const t = fl.costTotals(rows);
  assert.deepEqual({ tokens: t.tokens, usd: t.usd, unreported: t.unreported, passed: t.passed, per: t.usd_per_passed }, { tokens: 300015, usd: 2, unreported: 1, passed: 1, per: 2 });
  const table = fl.costTable(rows).split('\n');
  assert.match(table[0], /Total\s+Tokens\s+Cost$/);
  assert.ok(table.some(l => /^T1\s.*\s300k\s+\$1\.25$/.test(l)), table.join('|'));
  assert.match(table.at(-1), /; 300k tokens; \$2\.00 at list price \(\$2\.00 per passed task, everything included\)\. 1 model run\(s\) reported no usage/);
  assert.equal(fl.tokensText(1234567), '1.2M');
  assert.equal(fl.tokensText(999), '999');
  const packet = fl.acceptancePacket(root, 'b');
  assert.equal(packet.cost.usd, 2);
  assert.equal(packet.cost.tokens, 300015);
  assert.match(packet.md, /300k tokens\. \$2\.00 at list price/);
});
