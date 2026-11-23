import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { snapshot, check } from './guard.mjs';

test("a Python bytecode cache in a run folder is not a state change; a real file still is", () => {
  const root = mkdtempSync(join(tmpdir(), 'bridgie-guard-'));
  mkdirSync(join(root, '.bridgie', 'runs', 'b', 'implementer-01'), { recursive: true });
  writeFileSync(join(root, '.bridgie', 'runs', 'b', 'implementer-01', 'helper.py'), 'x = 1\n');
  const snap = join(root, 'snap');
  snapshot(root, snap);
  mkdirSync(join(root, '.bridgie', 'runs', 'b', 'implementer-01', '__pycache__'));
  writeFileSync(join(root, '.bridgie', 'runs', 'b', 'implementer-01', '__pycache__', 'helper.cpython-313.pyc'), 'bytecode');
  assert.deepEqual(check(root, snap), { added: [], removed: [], changed: [] });
  writeFileSync(join(root, '.bridgie', 'runs', 'b', 'implementer-01', 'planted.json'), '{}');
  assert.deepEqual(check(root, snap).added, ['.bridgie/runs/b/implementer-01/planted.json']);
});
