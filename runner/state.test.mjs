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
