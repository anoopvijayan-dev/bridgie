import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractLastJson } from '../adapters/lib/extract-json.mjs';

test('extracts the last json fence', () => {
  const t = 'thinking...\n```json\n{"a":1}\n```\nmore\n```json\n{"seat":"grill","summary_md":"x"}\n```\nbye\n';
  assert.deepEqual(extractLastJson(t), { seat: 'grill', summary_md: 'x' });
});

test('accepts an unlabelled fence when it parses as JSON, and handles CRLF', () => {
  assert.deepEqual(extractLastJson('ok\r\n```\r\n{"b":2}\r\n```\r\n'), { b: 2 });
});

test('falls back to a bare JSON reply', () => {
  assert.deepEqual(extractLastJson('  {"c":3}\n'), { c: 3 });
});

test('fails clearly with no block or invalid JSON', () => {
  assert.throws(() => extractLastJson('no json here'), /no JSON block/);
  assert.throws(() => extractLastJson('```json\n{bad}\n```'), /not valid JSON/);
});
