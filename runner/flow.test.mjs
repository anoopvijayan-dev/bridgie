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
