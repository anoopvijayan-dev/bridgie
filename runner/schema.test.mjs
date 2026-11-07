import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from './schema.mjs';

const schema = {
  type: 'object',
  required: ['id', 'status'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', pattern: '^[a-z0-9-]+$' },
    status: { type: 'string', enum: ['draft', 'signed'] },
    n: { type: ['integer', 'null'] },
    tags: { type: 'array', items: { type: 'string' }, minItems: 1 },
    owner: { $ref: '#/$defs/person' },
  },
  $defs: { person: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } } },
};

test('accepts a valid document', () => {
  assert.deepEqual(validate(schema, { id: 'a-1', status: 'draft', n: null, tags: ['x'], owner: { name: 'A' } }), []);
});

test('reports missing required, bad enum, wrong type, pattern, extra key, minItems, $ref', () => {
  const errs = validate(schema, { id: 'A!', status: 'nope', n: 1.5, tags: [], owner: {}, extra: 1 });
  const msgs = errs.join('\n');
  assert.match(msgs, /id: does not match pattern/);
  assert.match(msgs, /status: must be one of draft, signed/);
  assert.match(msgs, /n: expected integer\|null/);
  assert.match(msgs, /tags: expected at least 1 items/);
  assert.match(msgs, /owner.name: required/);
  assert.match(msgs, /extra: unexpected property/);
});

test('integer vs number', () => {
  assert.deepEqual(validate({ type: 'integer' }, 3), []);
  assert.equal(validate({ type: 'integer' }, 3.2).length, 1);
  assert.deepEqual(validate({ type: 'number' }, 3.2), []);
});
