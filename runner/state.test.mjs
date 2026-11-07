import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as st from './state.mjs';

function project() {
  const root = mkdtempSync(join(tmpdir(), 'bridgie-'));
  for (const d of ['bets', 'specs', 'runs', 'acceptance', 'decisions', 'learn']) mkdirSync(join(root, '.bridgie', d), { recursive: true });
  writeFileSync(join(root, '.bridgie', 'policy.yaml'), 'version: 1\nlanes:\n  engineering:\n    by_risk:\n      money: { min_confidence_to_sign: test }\n');
  return root;
}

test('readFm/writeFm round-trip and atomic write', () => {
  const root = project();
  const f = join(root, 'x.md');
  st.writeFm(f, { id: 'a', status: 'draft' }, '\n# A\n');
  assert.deepEqual(st.readFm(f).data, { id: 'a', status: 'draft' });
  st.setFm(f, { status: 'signed' });
  assert.equal(st.readFm(f).data.status, 'signed');
  assert.equal(st.readFm(f).body, '\n# A\n');
  assert.ok(!existsSync(f + '.tmp'));
});

test('loadPolicy deep-merges project overrides onto defaults', () => {
  const root = project();
  const p = st.loadPolicy(root);
  assert.equal(p.version, 1);
  assert.equal(p.lanes.engineering.by_risk.money.min_confidence_to_sign, 'test');     // overridden
  assert.equal(p.lanes.engineering.by_risk.money.human_ack_before_build, true);      // from default
  assert.equal(p.routing.tiers.judgment.adapter, 'claude-code');
});

test('betNew creates a valid bet and decisions file', () => {
  const root = project();
  const file = st.betNew(root, 'net-collect', { title: 'Net collect', lane: 'engineering', risk: 'money', owner: 'tester' });
  const { data } = st.readFm(file);
  assert.equal(data.status, 'draft');
  assert.equal(data.confidence, 'opinion');
  assert.ok(existsSync(join(root, '.bridgie', 'decisions', 'net-collect.json')));
  assert.throws(() => st.betNew(root, 'Bad Slug', {}), /slug/);
  assert.throws(() => st.betNew(root, 'net-collect', {}), /exists/);
});

test('betTransition enforces the status machine and sign gates', () => {
  const root = project();
  st.betNew(root, 'b', { title: 'B', lane: 'engineering', risk: 'money', owner: 'tester' });
  assert.throws(() => st.betTransition(root, 'b', 'signed', { by: 'tester' }), /draft → signed/);
  st.betTransition(root, 'b', 'grilling');
  st.betTransition(root, 'b', 'evidence');
  // confidence opinion < required test
  assert.throws(() => st.betTransition(root, 'b', 'signed', { by: 'tester' }), /confidence/);
  st.setFm(st.betPath(root, 'b'), { confidence: 'test' });
  assert.throws(() => st.betTransition(root, 'b', 'signed', { by: 'someone-else' }), /owner/);
  st.betTransition(root, 'b', 'signed', { by: 'tester' });
  const { data } = st.readFm(st.betPath(root, 'b'));
  assert.equal(data.status, 'signed');
  assert.equal(data.signed_by, 'tester');
  st.betTransition(root, 'b', 'killed');
  assert.throws(() => st.betTransition(root, 'b', 'grilling'), /killed → grilling/);
});

test('appendToSection adds under an existing heading or creates it', () => {
  const body = '# T\n\n## Open questions\n\n- q1\n\n## Decision log\n\n- d1\n';
  const out = st.appendToSection(body, 'Decision log', '- d2');
  assert.match(out, /## Decision log\n\n- d1\n- d2\n/);
  const out2 = st.appendToSection('# T\n', 'Evidence tasks', '- [ ] E1: x');
  assert.match(out2, /## Evidence tasks\n\n- \[ \] E1: x\n$/);
});
test('decisions: add, list, answer, don\'t-know creates an evidence task, sign gates', () => {
  const root = project();
  st.betNew(root, 'b', { title: 'B', lane: 'engineering', risk: 'none', owner: 'tester' });
  st.betTransition(root, 'b', 'grilling');
  const q = st.addDecision(root, 'b', { type: 'question', context: 'Who retries today?', options: ['yes', 'no', "don't know"], raised_by: { seat: 'grill', run: 'grill-1' } });
  assert.equal(q.id, 'D1');
  st.betTransition(root, 'b', 'evidence');
  const s = st.ensureSignDecision(root, 'b');
  assert.equal(s.id, 'D2');
  assert.equal(st.ensureSignDecision(root, 'b').id, 'D2');           // idempotent
  assert.equal(st.listDecisions(root, null, { pending: true }).length, 2);

  // pending question blocks signing
  assert.throws(() => st.answerDecision(root, 'b', 'D2', 'sign', { by: 'tester' }), /pending/);
  // invalid answer rejected
  assert.throws(() => st.answerDecision(root, 'b', 'D1', 'maybe'), /not one of/);
  // don't know → evidence task, question answered
  const a = st.answerDecision(root, 'b', 'D1', "don't know", { by: 'tester' });
  assert.equal(a.status, 'answered');
  assert.match(a.effect, /evidence task E1/);
  const body = st.readFm(st.betPath(root, 'b')).body;
  assert.match(body, /## Evidence tasks[\s\S]*- \[ \] E1: Who retries today\? \(from D1\)/);
  assert.match(body, /## Decision log[\s\S]*D1 \(question\): don't know/);
  // now sign succeeds (confidence opinion >= none-risk minimum 'opinion' from default policy)
  const signed = st.answerDecision(root, 'b', 'D2', 'sign', { by: 'tester' });
  assert.equal(signed.effect, 'bet signed');
  assert.equal(st.readFm(st.betPath(root, 'b')).data.status, 'signed');
  assert.throws(() => st.answerDecision(root, 'b', 'D2', 'sign', { by: 'tester' }), /already answered/);
});

test('decisions: defer keeps it in the inbox; kill and need-more-evidence effects', () => {
  const root = project();
  st.betNew(root, 'c', { title: 'C', lane: 'engineering', risk: 'none', owner: 'tester' });
  st.betTransition(root, 'c', 'grilling');
  const q = st.addDecision(root, 'c', { type: 'question', context: 'q', options: ['a'] });
  const d = st.answerDecision(root, 'c', q.id, 'defer');
  assert.equal(d.status, 'deferred');
  assert.equal(st.listDecisions(root, 'c', { pending: true }).length, 1);
  st.betTransition(root, 'c', 'evidence');
  const s = st.ensureSignDecision(root, 'c');
  st.answerDecision(root, 'c', s.id, 'need more evidence', { by: 'tester' });
  assert.equal(st.readFm(st.betPath(root, 'c')).data.status, 'evidence');
  const s2 = st.ensureSignDecision(root, 'c');                         // a fresh sign decision after the last was answered
  assert.notEqual(s2.id, s.id);
  st.answerDecision(root, 'c', s2.id, 'kill', { by: 'tester' });
  assert.equal(st.readFm(st.betPath(root, 'c')).data.status, 'killed');
});

test('ingestQuestions turns a seat output into decisions and lists them in the bet', () => {
  const root = project();
  st.betNew(root, 'd', { title: 'D', lane: 'engineering', risk: 'none', owner: 'tester' });
  st.betTransition(root, 'd', 'grilling');
  const out = join(root, 'out.json');
  writeFileSync(out, JSON.stringify({ seat: 'grill', summary_md: 'two gaps', questions: [{ context: 'Q one?', options: ['y', 'n'] }, { context: 'Q two?', options: ['a'], allow_free_text: true }] }));
  const ids = st.ingestQuestions(root, 'd', out, 'grill-1');
  assert.deepEqual(ids, ['D1', 'D2']);
  assert.match(st.readFm(st.betPath(root, 'd')).body, /## Open questions[\s\S]*- D1: Q one\?[\s\S]*- D2: Q two\?/);
  assert.equal(st.loadDecisions(root, 'd').decisions[1].allow_free_text, true);
});
test('route picks the seat override, else the tier default; env overrides both', () => {
  const root = project();
  assert.deepEqual(st.route(root, { name: 'reviewer', tier: 'judgment' }), { adapter: 'codex', model: 'default', effort: null });
  assert.deepEqual(st.route(root, { name: 'grill', tier: 'judgment' }), { adapter: 'claude-code', model: 'opus', effort: 'xhigh' });
  process.env.BRIDGIE_ADAPTER = 'fake';
  assert.equal(st.route(root, { name: 'grill', tier: 'judgment' }).adapter, 'fake');
  delete process.env.BRIDGIE_ADAPTER;
});

test('costAdd appends validated entries', () => {
  const root = project();
  const dir = join(root, '.bridgie', 'runs', 'b', 'grill-01'); mkdirSync(dir, { recursive: true });
  st.costAdd(dir, { seat: 'grill', adapter: 'fake', model: 'none', started_at: '2026-11-07T00:00:00Z', duration_s: 1.5, attempt: 1, exit_code: 0 });
  st.costAdd(dir, { seat: 'grill', adapter: 'fake', model: 'none', started_at: '2026-11-07T00:00:02Z', duration_s: 2, attempt: 2, exit_code: 1 });
  assert.equal(st.readJson(join(dir, 'cost.json')).entries.length, 2);
  assert.throws(() => st.costAdd(dir, { seat: 'grill' }), /invalid/);
});
test('grilling can revert to draft when a grill run fails', () => {
  const root = project();
  st.betNew(root, 'g', { title: 'G', lane: 'engineering', risk: 'none', owner: 'tester' });
  st.betTransition(root, 'g', 'grilling');
  st.betTransition(root, 'g', 'draft');
  assert.equal(st.readFm(st.betPath(root, 'g')).data.status, 'draft');
});
test('status summarises every bet with pending decision counts', () => {
  const root = project();
  st.betNew(root, 'a', { title: 'A', lane: 'engineering', risk: 'none', owner: 'tester' });
  st.betNew(root, 'b', { title: 'B', lane: 'marketing', risk: 'ux', owner: 'tester' });
  st.betTransition(root, 'b', 'grilling');
  st.addDecision(root, 'b', { type: 'question', context: 'q', options: ['x'] });
  const rows = st.status(root);
  assert.deepEqual(rows.map(r => [r.slug, r.status, r.pending]), [['a', 'draft', 0], ['b', 'grilling', 1]]);
  const table = st.statusTable(rows);
  assert.match(table, /SLUG\s+LANE\s+RISK\s+STATUS\s+CONF\s+PENDING\s+TASKS\s+TITLE/);
  assert.match(table, /b\s+marketing\s+ux\s+grilling\s+opinion\s+1\s+-\s+B/);
  assert.equal(st.statusTable([]), 'No bets yet. Create one with: bridgie bet new <slug>');
});
