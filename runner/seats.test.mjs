import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { splitFrontmatter } from './yaml.mjs';
import { validate } from './schema.mjs';
import { HOME, loadSchema } from './state.mjs';

const EXPECTED = ['decide/scout', 'decide/framer', 'decide/grill', 'decide/evidence', 'build/shaper', 'build/decomposer', 'build/implementer', 'build/hardener', 'verify/mechanical', 'verify/reviewer', 'verify/invariants', 'accept/packager', 'learn/retro'];

test('every expected seat exists with a valid manifest and a body under 150 lines', () => {
  const schema = loadSchema('seat');
  for (const s of EXPECTED) {
    const f = join(HOME, 'seats', s, 'SKILL.md');
    assert.ok(existsSync(f), `missing ${f}`);
    const { data, body } = splitFrontmatter(readFileSync(f, 'utf8'));
    assert.deepEqual(validate(schema, data), [], `${s}: ${validate(schema, data).join('; ')}`);
    assert.equal(data.name, s.split('/')[1], `${s}: name must match folder`);
    assert.equal(data.loop, s.split('/')[0], `${s}: loop must match folder`);
    assert.ok(body.split('\n').length < 150, `${s}: body too long`);
    for (const h of ['## Role', '## Judgment criteria', '## Output contract', '## Stop conditions']) assert.ok(body.includes(h), `${s}: missing ${h}`);
    for (const r of data.references || []) assert.ok(existsSync(join(HOME, 'seats', s, r)), `${s}: reference ${r} missing`);
  }
});

test('engineering lane files exist and risk-paths parse', () => {
  const lane = join(HOME, 'lanes', 'engineering');
  for (const f of ['risk-paths.yaml', 'attacks.md', 'verifiers.yaml', 'gotchas.md']) assert.ok(existsSync(join(lane, f)), f);
  assert.ok(readdirSync(join(lane, 'checklists')).length >= 7);
});
