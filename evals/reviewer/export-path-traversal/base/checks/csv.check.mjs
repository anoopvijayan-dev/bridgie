import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv } from '../src/csv.mjs';

test('cells with commas and quotes are quoted', () => {
  assert.equal(toCsv([['a', 'b,c', 'say "hi"']]), 'a,"b,c","say ""hi"""\n');
});
