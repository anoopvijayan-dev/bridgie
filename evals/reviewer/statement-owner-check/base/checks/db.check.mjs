import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from '../src/db.mjs';

test('an unknown id is null', () => {
  assert.equal(makeDb([]).getStatement('s1'), null);
});
