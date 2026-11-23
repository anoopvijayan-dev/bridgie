import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from '../src/db.mjs';
import { getStatement } from '../src/statements.mjs';

const db = makeDb([{ id: 's1', account_id: 'acct-1', lines: [] }]);
const alice = { id: 'u1', account_id: 'acct-1' };

test('the owner reads the statement', () => {
  assert.equal(getStatement(db, { user: alice, params: { id: 's1' } }).status, 200);
});

test('no signed-in user gets 401', () => {
  assert.equal(getStatement(db, { user: null, params: { id: 's1' } }).status, 401);
});

test('an unknown statement gets 404', () => {
  assert.equal(getStatement(db, { user: alice, params: { id: 'nope' } }).status, 404);
});
