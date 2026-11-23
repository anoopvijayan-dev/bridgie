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
  // money needs unit economics (require_numbers)
  assert.throws(() => st.betTransition(root, 'b', 'signed', { by: 'tester' }), /unit economics/);
  writeFileSync(join(root, '.bridgie', 'bets', 'b', 'numbers.json'), JSON.stringify({ contribution_per_unit: 3, checks: { unit_positive: true } }));
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

test("decisions: the seats' own spellings of don't know also create evidence tasks", () => {
  const root = project();
  st.betNew(root, 'b', { title: 'B', lane: 'engineering', risk: 'none', owner: 'tester' });
  st.betTransition(root, 'b', 'grilling');
  const opts = ['1 to 3 hours', "Don't know", "Don't know (timing not done yet)", 'Don’t know'];
  for (const o of opts.slice(1)) st.addDecision(root, 'b', { type: 'question', context: `Q ${o}`, options: opts, raised_by: { seat: 'grill', run: 'grill-1' } });
  assert.match(st.answerDecision(root, 'b', 'D1', "Don't know", { by: 'tester' }).effect, /evidence task E1/);
  assert.match(st.answerDecision(root, 'b', 'D2', "Don't know (timing not done yet)", { by: 'tester' }).effect, /evidence task E2/);
  assert.match(st.answerDecision(root, 'b', 'D3', 'Don’t know', { by: 'tester' }).effect, /evidence task E3/);
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
  // a pinned adapter other than the routed one never gets the routed CLI's model name or effort
  process.env.BRIDGIE_ADAPTER = 'claude-code';
  assert.deepEqual(st.route(root, { name: 'evidence', tier: 'production' }), { adapter: 'claude-code', model: 'default', effort: null });
  assert.deepEqual(st.route(root, { name: 'grill', tier: 'judgment' }), { adapter: 'claude-code', model: 'opus', effort: 'xhigh' });
  process.env.BRIDGIE_MODEL = 'sonnet';
  assert.equal(st.route(root, { name: 'evidence', tier: 'production' }).model, 'sonnet');
  delete process.env.BRIDGIE_ADAPTER; delete process.env.BRIDGIE_MODEL;
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

test('user policy sits between defaults and the project', () => {
  const root = project();
  const uf = join(root, 'user-policy.yaml');
  writeFileSync(uf, 'version: 1\nrouting:\n  tiers:\n    judgment: { adapter: copilot, model: claude-opus-5.5 }\nlanes:\n  engineering:\n    by_risk:\n      money: { min_confidence_to_sign: anecdote }\n');
  process.env.BRIDGIE_USER_POLICY = uf;
  const p = st.loadPolicy(root);
  delete process.env.BRIDGIE_USER_POLICY;
  assert.equal(p.routing.tiers.judgment.adapter, 'copilot');                          // from user
  assert.equal(p.lanes.engineering.by_risk.money.min_confidence_to_sign, 'test');     // project wins
});

test('supersedeDecisions closes matching pending decisions, keeps them, and logs why', () => {
  const root = project();
  st.betNew(root, 'b', { title: 'B', lane: 'engineering', risk: 'none', owner: 'tester' });
  const u = st.addDecision(root, 'b', { type: 'unblock', context: 'T1 blocked', options: ['retry with guidance', 'kill task'], task: 'T1' });
  const q = st.addDecision(root, 'b', { type: 'question', context: 'Q?', options: ['yes', 'no'] });
  assert.deepEqual(st.supersedeDecisions(root, 'b', d => d.type === 'unblock', 're-planned', { by: 'tester' }), [u.id]);
  const ds = st.loadDecisions(root, 'b').decisions;
  assert.equal(ds.find(d => d.id === u.id).status, 'answered');
  assert.equal(ds.find(d => d.id === u.id).answer, 'superseded');
  assert.equal(st.listDecisions(root, 'b', { pending: true }).length, 1);   // no longer waiting
  assert.equal(ds.find(d => d.id === q.id).status, 'pending');
  assert.match(st.readFm(st.betPath(root, 'b')).body, new RegExp(`${u.id}: superseded \\(re-planned\\)`));
});

test('quotaFromText reads a usage limit and its reset time from an adapter log', () => {
  const now = Date.parse('2026-11-22T22:22:00Z');
  assert.equal(st.quotaFromText('adapter: the CLI is signed out\nsome other failure', now), null);
  const agy = st.quotaFromText('AGY_ERROR: {"short_error":"RESOURCE_EXHAUSTED (code 429): Individual quota reached. Please upgrade. Resets in 3h8m35s."}', now);
  assert.equal(agy.until, '2026-11-23T01:30:35.000Z');
  assert.match(agy.why, /RESOURCE_EXHAUSTED/);
  assert.equal(st.quotaFromText("You've hit your usage limit. Try again at 2026-11-25 08:25 UTC.", now).until, '2026-11-25T08:25:00.000Z');
  // a limit that names no time, or a time already past, is tried again in half an hour
  assert.equal(st.quotaFromText('error: rate limit exceeded', now).until, '2026-11-22T22:52:00.000Z');
  assert.equal(st.quotaFromText('usage limit reached; it reset at 2020-01-01 00:00', now).until, '2026-11-22T22:52:00.000Z');
});

test('an exhausted adapter is remembered per machine until its limit resets, and only from this launch\'s logs', () => {
  const root = mkdtempSync(join(tmpdir(), 'bridgie-quota-'));
  mkdirSync(join(root, '.bridgie', 'runs', 'b', 'reviewer-01'), { recursive: true });
  const run = join(root, '.bridgie', 'runs', 'b', 'reviewer-01');
  writeFileSync(join(run, 'agy.log'), 'error: Individual quota reached. Resets in 2h.\n');
  const now = Date.now();
  assert.equal(st.quotaFromRun(run, now + 60000, now), null);            // written before this launch began
  const q = st.quotaFromRun(run, now - 60000, now);
  assert.equal(Date.parse(q.until), now + 2 * 3600000);
  assert.equal(st.exhaustedUntil(root, 'antigravity'), null);
  st.markExhausted(root, 'antigravity', q.until, q.why);
  assert.equal(st.exhaustedUntil(root, 'antigravity', now), q.until);
  assert.equal(st.exhaustedUntil(root, 'antigravity', now + 3 * 3600000), null);   // reset: usable again
  assert.equal(st.exhaustedUntil(root, 'codex', now), null);
});
