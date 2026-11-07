import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, stringify, splitFrontmatter, joinFrontmatter } from './yaml.mjs';

test('parses scalars, inline maps and arrays, block lists, nesting', () => {
  const doc = `
id: net-collect
title: "Net collection: retries"   # comment
risk: money
appetite: { time: 6w, tokens_usd: 60 }
kill_criteria:
  - second round does not confirm
  - "quoted, with comma"
outcome_metric: { name: churn, baseline: "4.1%", target: 2.5, read_by: 2027-02-01 }
non_goals: [ "refunds workflow", other ]
flags:
  enabled: true
  nothing: null
  nested:
    deep: 1
`;
  const v = parse(doc);
  assert.equal(v.id, 'net-collect');
  assert.equal(v.title, 'Net collection: retries');
  assert.deepEqual(v.appetite, { time: '6w', tokens_usd: 60 });
  assert.deepEqual(v.kill_criteria, ['second round does not confirm', 'quoted, with comma']);
  assert.equal(v.outcome_metric.baseline, '4.1%');
  assert.equal(v.outcome_metric.target, 2.5);
  assert.equal(v.outcome_metric.read_by, '2027-02-01');
  assert.deepEqual(v.non_goals, ['refunds workflow', 'other']);
  assert.equal(v.flags.enabled, true);
  assert.equal(v.flags.nothing, null);
  assert.equal(v.flags.nested.deep, 1);
});

test('round-trips through stringify', () => {
  const v = { id: 'x', n: 3, ok: false, list: ['a', 'b c'], map: { k: 'v', q: 'has: colon' }, nested: { a: { b: 'c' } } };
  const again = parse(stringify(v));
  assert.deepEqual(again, v);
});

test('splits and joins frontmatter', () => {
  const md = `---\nid: a\nstatus: draft\n---\n\n# Title\n\nbody\n`;
  const { data, body } = splitFrontmatter(md);
  assert.deepEqual(data, { id: 'a', status: 'draft' });
  assert.equal(body, '\n# Title\n\nbody\n');
  const out = joinFrontmatter({ ...data, status: 'signed' }, body);
  assert.equal(splitFrontmatter(out).data.status, 'signed');
  assert.equal(splitFrontmatter(out).body, body);
});

test('file without frontmatter yields empty data', () => {
  const { data, body } = splitFrontmatter('# nope\n');
  assert.deepEqual(data, {});
  assert.equal(body, '# nope\n');
});
