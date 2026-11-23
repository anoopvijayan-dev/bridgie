import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as st from './state.mjs';
import { assemble, loadSeat } from './context.mjs';

function project() {
  const root = mkdtempSync(join(tmpdir(), 'bridgie-ctx-'));
  for (const d of ['bets', 'specs', 'runs', 'acceptance', 'decisions', 'learn']) mkdirSync(join(root, '.bridgie', d), { recursive: true });
  writeFileSync(join(root, '.bridgie', 'policy.yaml'), 'version: 1\n');
  writeFileSync(join(root, '.bridgie', 'learn', 'gotchas.md'), '# Gotchas\n- PROJECT-GOTCHA-MARKER\n');
  st.betNew(root, 'b', { title: 'UNIQUE-BET-TITLE', lane: 'engineering', risk: 'none', owner: 'tester' });
  mkdirSync(join(root, '.bridgie', 'specs', 'b'), { recursive: true });
  writeFileSync(join(root, '.bridgie', 'specs', 'b', 'design.md'), '# Design\nDECOY-DESIGN-MARKER\n');
  writeFileSync(join(root, '.bridgie', 'specs', 'b', 'requirements.md'), '## R1 · event\nWHEN x THE SYSTEM SHALL y\n');
  st.writeJsonAtomic(join(root, '.bridgie', 'specs', 'b', 'tasks.json'), { bet: 'b', tasks: [{ id: 'T1', title: 'TASK-ONE-TITLE', requirements: ['R1'], depends_on: [], status: 'todo', attempts: 0, max_attempts: 3, branch: null, evidence: null, escalation: null }] }, 'tasks');
  return root;
}

test('loadSeat returns a validated manifest and body', () => {
  const s = loadSeat('decide/grill');
  assert.equal(s.manifest.name, 'grill');
  assert.ok(s.body.includes('## Role'));
  assert.throws(() => loadSeat('decide/nope'), /no such seat/);
});

test('assemble includes only declared inputs (P2)', () => {
  const root = project();
  const runDir = join(root, '.bridgie', 'runs', 'b', 'grill-01'); mkdirSync(runDir, { recursive: true });
  const r = assemble(root, 'b', 'decide/grill', { runDir, cwd: root });
  assert.ok(r.prompt.includes('UNIQUE-BET-TITLE'));
  assert.ok(r.prompt.includes('PROJECT-GOTCHA-MARKER'));
  assert.ok(!r.prompt.includes('DECOY-DESIGN-MARKER'), 'design must not leak into a seat that did not declare it');
  assert.ok(!r.prompt.includes('TASK-ONE-TITLE'));
  assert.deepEqual(r.inputs, ['bet', 'gotchas']);
  assert.ok(r.prompt.includes(`${runDir}`));
  assert.ok(r.prompt.includes('seat-output.json'));
});

test('assemble resolves task and design for the implementer and fails on a missing required input', () => {
  const root = project();
  const runDir = join(root, '.bridgie', 'runs', 'b', 'implementer-01'); mkdirSync(runDir, { recursive: true });
  const r = assemble(root, 'b', 'build/implementer', { runDir, cwd: root, task: 'T1' });
  assert.ok(r.prompt.includes('TASK-ONE-TITLE'));
  assert.ok(r.prompt.includes('DECOY-DESIGN-MARKER'));
  assert.ok(r.missing.includes('evidence'));            // optional, absent, reported
  assert.throws(() => assemble(root, 'b', 'build/implementer', { runDir, cwd: root }), /--task/);
  assert.throws(() => assemble(root, 'b', 'build/implementer', { runDir, cwd: root, task: 'T9' }), /T9/);
});

test('references declared in the manifest are appended', () => {
  const root = project();
  const runDir = join(root, '.bridgie', 'runs', 'b', 'shaper-01'); mkdirSync(runDir, { recursive: true });
  const r = assemble(root, 'b', 'build/shaper', { runDir, cwd: root });
  assert.ok(r.prompt.includes('# Security perspective'));
  assert.ok(r.prompt.includes('# Data-intensive design perspective'));
});

test('the implementer prompt carries the claim schema, dispositions[].evidence included', () => {
  const root = project(), runDir = join(root, '.bridgie', 'runs', 'b', 'implementer-01'); mkdirSync(runDir, { recursive: true });
  const r = assemble(root, 'b', 'build/implementer', { runDir, cwd: root, task: 'T1' });
  const schema = JSON.stringify(JSON.parse(readFileSync(new URL('../schemas/claim.json', import.meta.url), 'utf8')));
  assert.ok(r.prompt.includes(schema), 'claim.json schema inlined');
  assert.match(r.prompt, /"required":\["finding","disposition","evidence"\]/);
});
