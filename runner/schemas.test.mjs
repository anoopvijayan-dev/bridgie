import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate } from './schema.mjs';
import { parse } from './yaml.mjs';

const S = n => JSON.parse(readFileSync(new URL(`../schemas/${n}.json`, import.meta.url), 'utf8'));

test('bet frontmatter example from the spec validates', () => {
  const fm = parse(`
id: net-collect
title: Net collection for failed card payments
lane: engineering
risk: money
owner: anoop
status: draft
appetite: { time: 6w, tokens_usd: 60 }
confidence: anecdote
kill_criteria:
  - second interview round does not confirm the problem
outcome_metric: { name: churn_plan_x, baseline: "4.1%", target: "2.5%", read_by: 2027-02-01 }
non_goals: [ "refunds workflow" ]
`);
  assert.deepEqual(validate(S('bet'), fm), []);
});

test('default policy validates', () => {
  const pol = parse(readFileSync(new URL('../policy/default.yaml', import.meta.url), 'utf8'));
  assert.deepEqual(validate(S('policy'), pol), []);
});

test('decisions and seat-output examples validate', () => {
  assert.deepEqual(validate(S('decisions'), { bet: 'x', next_id: 2, decisions: [{ id: 'D1', type: 'question', context: 'c', options: ['a'], status: 'pending', created_at: '2026-11-07T00:00:00Z' }] }), []);
  assert.deepEqual(validate(S('seat-output'), { seat: 'grill', summary_md: 's', questions: [{ context: 'q', options: ['yes', 'no', "don't know"], allow_free_text: true }] }), []);
});

test('every schema file is valid JSON with a type', () => {
  for (const n of ['bet', 'decisions', 'policy', 'seat', 'seat-output', 'cost', 'tasks', 'claim', 'evidence', 'acceptance']) {
    assert.equal(S(n).type, 'object', n);
  }
});
