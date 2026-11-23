import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeExport } from '../src/export.mjs';

test('writes <name>.csv in the exports folder', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'exp-')), 'exports');
  const file = writeExport(dir, 'march', [['date', 'amount'], ['2026-03-01', '12.50']]);
  assert.equal(file, join(dir, 'march.csv'));
  assert.equal(readFileSync(file, 'utf8'), 'date,amount\n2026-03-01,12.50\n');
});

test('an empty name is refused', () => {
  assert.throws(() => writeExport(mkdtempSync(join(tmpdir(), 'exp-')), '  ', []), /needs a name/);
});
