// Regression tests for the external review of 2026-11-07 (findings 1–3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as st from './state.mjs';
import * as fl from './flow.mjs';

const REQS = risk => `# Requirements\n\n## R1 · event · risk: none\nWHEN a THE SYSTEM SHALL b\n\n## R2 · event · risk: ${risk}\nWHEN c THE SYSTEM SHALL d\n`;
function project(betRisk = 'none', reqRisk = 'none', policy = 'version: 1\n') {
  const root = mkdtempSync(join(tmpdir(), 'bridgie-hard-'));
  for (const d of ['bets', 'specs', 'runs', 'acceptance', 'decisions', 'learn']) mkdirSync(join(root, '.bridgie', d), { recursive: true });
  writeFileSync(join(root, '.bridgie', 'policy.yaml'), policy);
  st.betNew(root, 'b', { title: 'B', lane: 'engineering', risk: betRisk, owner: 'tester' });
  for (const s of ['grilling', 'evidence']) st.betTransition(root, 'b', s);
  st.setFm(st.betPath(root, 'b'), { confidence: 'test' });
  st.betTransition(root, 'b', 'signed', { by: 'tester' });
  mkdirSync(join(root, '.bridgie', 'specs', 'b'), { recursive: true });
  writeFileSync(join(root, '.bridgie', 'specs', 'b', 'requirements.md'), REQS(reqRisk));
  return root;
}
function plan(root, tasks = [{ id: 'T1', title: 't1', requirements: ['R1', 'R2'] }]) {
  const f = join(root, `plan-${Math.random()}.json`);
  writeFileSync(f, JSON.stringify({ seat: 'decomposer', summary_md: 's', artifact_md: '```json\n' + JSON.stringify({ tasks }) + '\n```' }));
  return fl.writeTasksFromPlan(root, 'b', f);
}
const row = (id, result = 'pass', tier = 'adversarial') => ({ id, tier, check: `check ${id} ${tier}`, result, artifact: null });
function review(root, rows, verdict = 'pass', findings = []) {
  const f = join(root, `rev-${Math.random()}.json`);
  writeFileSync(f, JSON.stringify({ task: 'T1', criteria: rows, findings, verdict, verifier: { seat: 'reviewer', adapter: 'fake', model: 'm' } }));
  return f;
}
function toVerify(root) { fl.startAttempt(root, 'b', 'T1', 'br'); fl.setTask(root, 'b', 'T1', { status: 'verify' }); }

// ---------- finding 2: reconciliation ----------
test('reconcile: a failing row after a passing row for the same requirement fails the task', () => {
  const root = project(); plan(root); toVerify(root);
  const r = fl.reconcile(root, 'b', 'T1', review(root, [row('R1'), row('R2'), row('R2', 'fail', 'invariants')], 'fail'), [], join(root, 'e.json'));
  assert.equal(r.verdict, 'fail');
  assert.equal(r.evidence.criteria.filter(c => c.id === 'R2').length, 2, 'both R2 rows are kept');
});

test('reconcile: the reviewer verdict can only tighten the result', () => {
  let root = project(); plan(root); toVerify(root);
  assert.equal(fl.reconcile(root, 'b', 'T1', review(root, [row('R1'), row('R2')], 'fail'), [], join(root, 'e.json')).verdict, 'fail');
  root = project(); plan(root); toVerify(root);
  assert.equal(fl.reconcile(root, 'b', 'T1', review(root, [row('R1'), row('R2')], 'not_proven'), [], join(root, 'e.json')).verdict, 'not_proven');
  root = project(); plan(root); toVerify(root);
  assert.equal(fl.reconcile(root, 'b', 'T1', review(root, [row('R1'), row('R2'), row('R9', 'fail')], 'pass'), [], join(root, 'e.json')).verdict, 'fail', 'a failing row outside the task still counts');
});

// ---------- finding 1: acceptance ----------
function passedAndPackaged(root) {
  plan(root); toVerify(root);
  const ev = join(root, '.bridgie', 'runs', 'ev.json');
  fl.reconcile(root, 'b', 'T1', review(root, [row('R1'), row('R2')]), [], ev);
  fl.markPassed(root, 'b', 'T1', ev);
  fl.writeAcceptance(root, 'b', { body: '## Evidence\n', residual: [], cost: {} });
  return { ev, d: st.listDecisions(root, 'b', { pending: true }).find(x => x.type === 'accept') };
}

test('acceptance: re-planning after packaging supersedes the package; the old decision cannot deliver', () => {
  const root = project();
  const { d } = passedAndPackaged(root);
  plan(root);                                                         // tasks back to todo
  assert.throws(() => fl.answer(root, 'b', d.id, 'approve', { by: 'tester' }), /already answered|superseded|stale/);
  assert.equal(st.readFm(st.betPath(root, 'b')).data.status, 'signed');
  assert.equal(st.readFm(fl.acceptancePath(root, 'b')).data.decision, 'superseded');
});

test('acceptance: approval re-checks the gates even if the decision is still pending', () => {
  const root = project();
  const { d } = passedAndPackaged(root);
  fl.setTask(root, 'b', 'T1', { status: 'todo' });                   // any route back to not-passed
  assert.throws(() => fl.answer(root, 'b', d.id, 'approve', { by: 'tester' }), /stale: tasks no longer passed: T1/);
  assert.equal(st.readFm(st.betPath(root, 'b')).data.status, 'signed');
});

test('acceptance: changed evidence or spec after packaging makes the approval stale', () => {
  const root = project();
  const { d, ev } = passedAndPackaged(root);
  const e = JSON.parse(readFileSync(ev, 'utf8')); e.criteria[0].check = 'edited later'; writeFileSync(ev, JSON.stringify(e));
  assert.throws(() => fl.answer(root, 'b', d.id, 'approve', { by: 'tester' }), /stale: requirements, design, tasks or evidence changed/);
});

test('acceptance: approvals record the packaged digest', () => {
  const root = project();
  const { d } = passedAndPackaged(root);
  fl.answer(root, 'b', d.id, 'approve', { by: 'tester' });
  const a = st.readFm(fl.acceptancePath(root, 'b')).data;
  assert.equal(a.decision, 'approved');
  assert.equal(a.approvals[0].digest, a.packaged_digest);
  assert.match(a.packaged_digest, /^[0-9a-f]{64}$/);
});

// ---------- finding 3: effective risk and mandatory tiers ----------
test('a requirement tagged money raises the bet risk at plan time, with a risk log line', () => {
  const root = project('none', 'money');
  plan(root);
  const { data, body } = st.readFm(st.betPath(root, 'b'));
  assert.equal(data.risk, 'money');
  assert.match(body, /## Risk log[\s\S]*risk none → money: requirement R2 is tagged risk: money/);
  assert.deepEqual(fl.mechanicalPlan(root, 'b', mkdtempSync(join(tmpdir(), 'wt-'))).map(x => x.tier),
    ['mechanical', 'specified', 'contracts', 'invariants', 'behavioural', 'dual_run'], 'money tiers apply');
});

test('raiseRisk never lowers; riskOfPaths reports the effective risk', () => {
  const root = project('security', 'none', 'version: 1\nlanes:\n  engineering:\n    risk_paths:\n      - { glob: "src/ledger/**", risk: money }\n');
  assert.equal(st.raiseRisk(root, 'b', 'ux', 'x').changed, false);
  const r = fl.riskOfPaths(root, 'b', ['src/ledger/post.ts']);
  assert.equal(r.effective, 'money');
  st.raiseRisk(root, 'b', r.effective, 'paths');
  assert.equal(st.readFm(st.betPath(root, 'b')).data.risk, 'money');
});

test('an ack given at a lower risk does not cover a raised risk', () => {
  const root = project('data');
  const d = fl.ensureDecision(root, 'b', 'ack_risk', 'data paths', ['ack', 'decline'], { risk: 'data' });
  fl.answer(root, 'b', d.id, 'ack', { by: 'tester' });
  assert.equal(fl.ackRecorded(root, 'b'), true);
  st.raiseRisk(root, 'b', 'money', 'ledger paths');
  assert.equal(fl.ackRecorded(root, 'b'), false);
});

test('acceptance uses the raised risk for the approver count', () => {
  const root = project('none', 'money');
  const { d } = passedAndPackaged(root);
  fl.answer(root, 'b', d.id, 'approve', { by: 'tester' });
  assert.equal(st.readFm(fl.acceptancePath(root, 'b')).data.decision, 'pending', 'money needs two approvers');
});

// ---------- M3: numbers gate and confidence decisions ----------
test('a money bet cannot be signed without positive unit economics', () => {
  const root = mkdtempSync(join(tmpdir(), 'bridgie-nums-'));
  for (const d of ['bets', 'specs', 'runs', 'acceptance', 'decisions', 'learn']) mkdirSync(join(root, '.bridgie', d), { recursive: true });
  writeFileSync(join(root, '.bridgie', 'policy.yaml'), 'version: 1\n');
  st.betNew(root, 'm', { title: 'M', lane: 'product', risk: 'money', owner: 'tester' });
  for (const s of ['grilling', 'evidence']) st.betTransition(root, 'm', s);
  st.setFm(st.betPath(root, 'm'), { confidence: 'data' });
  assert.throws(() => st.betTransition(root, 'm', 'signed', { by: 'tester' }), /requires unit economics/);
  writeFileSync(join(root, '.bridgie', 'bets', 'm', 'numbers.json'), JSON.stringify({ contribution_per_unit: -2, checks: { unit_positive: false } }));
  assert.throws(() => st.betTransition(root, 'm', 'signed', { by: 'tester' }), /loses money/);
  writeFileSync(join(root, '.bridgie', 'bets', 'm', 'numbers.json'), JSON.stringify({ contribution_per_unit: 5, checks: { unit_positive: true } }));
  st.betTransition(root, 'm', 'signed', { by: 'tester' });
  assert.equal(st.readFm(st.betPath(root, 'm')).data.status, 'signed');
});

test('a confidence proposal becomes a decision; accepting sets the tier, keeping leaves it', () => {
  const root = project();
  assert.equal(fl.proposeConfidence(root, 'b', 'test: nothing new'), null);          // project() signs at confidence test
  const d = fl.proposeConfidence(root, 'b', 'anecdote: three brokers said the same thing', { seat: 'evidence', run: 'evidence-01' });
  assert.deepEqual(d.options, ['accept anecdote', 'keep test']);
  fl.answer(root, 'b', d.id, 'keep test', { by: 'tester' });
  assert.equal(st.readFm(st.betPath(root, 'b')).data.confidence, 'test');
  const d2 = fl.proposeConfidence(root, 'b', 'data: 40 timesheets measured');
  fl.answer(root, 'b', d2.id, 'accept data', { by: 'tester' });
  assert.equal(st.readFm(st.betPath(root, 'b')).data.confidence, 'data');
});
