import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import * as m from './mutate.mjs';

const sh = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
function repo(files) {
  const d = mkdtempSync(join(tmpdir(), 'bridgie-mut-'));
  sh(d, 'init', '-q', '-b', 'main'); sh(d, 'config', 'user.email', 't@example.com'); sh(d, 'config', 'user.name', 't');
  writeFileSync(join(d, 'README.md'), 'x\n'); sh(d, 'add', '-A'); sh(d, 'commit', '-q', '-m', 'base');
  for (const [f, text] of Object.entries(files)) { mkdirSync(join(d, f, '..'), { recursive: true }); writeFileSync(join(d, f), text); }
  return d;
}
const muts = (text, lines) => m.candidates(text, lines).map(c => `${c.line}:${c.from}→${c.to}`);

test('candidates: operators, conditions, booleans and whole numbers on the given lines', () => {
  assert.deepEqual(muts('if total >= limit and not closed:\n', [1]), ['1:>=→>', '1:and→or', '1:not→']);
  assert.deepEqual(muts('return a + b * 2\n', [1]), ['1:+→-', '1:*→/', '1:2→3']);
  assert.deepEqual(muts('if (a === b || !ready) return false;\n', [1]), ['1:===→!==', '1:||→&&', '1:false→true', '1:!→']);
  assert.deepEqual(muts('ok = x != 0\n', [1]), ['1:!=→==', '1:0→1']);
  assert.deepEqual(muts('a > b\nc < d\n', [2]), ['2:<→<=']);                     // only the lines asked for
  const one = m.candidates('if order_pence > LIMIT:\n', [1])[0];
  assert.equal(one.text, 'if order_pence >= LIMIT:');
});

test('candidates: nothing inside strings, comments, imports, or things that only look like operators', () => {
  assert.deepEqual(muts('log("a > b and c == 1")\n', [1]), []);
  assert.deepEqual(muts("msg = 'not found'  # retry if x > 3\n", [1]), []);
  assert.deepEqual(muts('// if (a > b) return true\n', [1]), []);
  assert.deepEqual(muts('# x == 2\n', [1]), []);
  assert.deepEqual(muts('from a import b\nimport { x } from "y";\n', [1, 2]), []);
  assert.deepEqual(muts('const f = (a) => a;\nList<int> xs;\nx -> y\n', [1, 2, 3]), []);          // arrows and generics have no spaces round < >
  assert.deepEqual(muts('v = 1.5\nname2 = x3\n', [1, 2]), []);                                   // not whole numbers
  assert.deepEqual(muts('x = "it\\"s > 1" if a > 1 else b\n', [1]), ['1:>→>=', '1:1→2']);        // an escaped quote does not end the string
});

test('isMutable: code files only, never tests or fixtures', () => {
  for (const f of ['src/pay/refund.py', 'lib/a.mjs', 'App/Billing.cs', 'x.ts']) assert.ok(m.isMutable(f), f);
  for (const f of ['tests/test_refund.py', 'src/a.test.mjs', 'spec/a.js', 'README.md', 'data.json', 'pkg/__tests__/a.ts', 'src/refund_test.go', 'checks/x.check.mjs', 'App.Tests/BillingTests.cs']) assert.ok(!m.isMutable(f), f);
});

test('pick spreads the mutants over the changed lines before any line gets a second one', () => {
  const all = [1, 1, 1, 2, 3, 3].map((line, i) => ({ file: 'a.py', line, i }));
  assert.deepEqual(m.pick(all, 3).map(c => c.line), [1, 2, 3]);
  assert.deepEqual(m.pick(all, 5).map(c => c.i), [0, 3, 4, 1, 5]);
  assert.equal(m.pick(all, 50).length, 6);
});

const CALC = 'export function shipping(total) {\n  if (total >= 100) return 0;\n  return 5;\n}\n';
const check = body => `import assert from 'node:assert/strict';\nimport { shipping } from '../src/calc.mjs';\n${body}\n`;

test('run: weak tests let mutants survive and miss the bar; tests at the boundary notice every one; files are put back', () => {
  const weak = repo({ 'src/calc.mjs': CALC, 'checks/calc.check.mjs': check('assert.equal(shipping(500), 0);\nassert.equal(typeof shipping(1), "number");') });
  const out = [];
  const r = m.run(weak, { base: 'main', test: 'node checks/calc.check.mjs', print: s => out.push(s) });
  assert.equal(r.total, 4);
  assert.deepEqual(r.survivors.map(s => `${s.line}:${s.from}→${s.to}`), ['2:>=→>', '3:5→6', '2:100→101']);
  assert.equal(r.killed, 1);                                   // only "return 0" becoming "return 1" is noticed
  assert.equal(r.ok, false);
  assert.ok(out.some(l => /survived {2}src\/calc\.mjs:2 {2}">=" → ">" {4}if \(total >= 100\) return 0;/.test(l)), out.join('\n'));
  assert.match(out.at(-2), /1 of 4 noticed by the tests \(25%\); 3 survived; the bar is 60%/);
  assert.equal(readFileSync(join(weak, 'src/calc.mjs'), 'utf8'), CALC);
  assert.equal(m.changedLines(weak, 'main')['checks/calc.check.mjs'], undefined, 'test files are not mutated');

  const strong = repo({ 'src/calc.mjs': CALC, 'checks/calc.check.mjs': check('assert.equal(shipping(100), 0);\nassert.equal(shipping(99), 5);\nassert.equal(shipping(500), 0);') });
  const s = m.run(strong, { base: 'main', test: 'node checks/calc.check.mjs', print: () => {} });
  assert.deepEqual({ total: s.total, killed: s.killed, ok: s.ok }, { total: 4, killed: 4, ok: true });
});

test('run: only lines the change added count; committed and uncommitted changes both do', () => {
  const d = repo({});
  mkdirSync(join(d, 'src')); writeFileSync(join(d, 'src/old.mjs'), 'export const old = a => a > 1;\n'); sh(d, 'add', '-A'); sh(d, 'commit', '-q', '-m', 'old code');
  sh(d, 'branch', 'base');
  writeFileSync(join(d, 'src/old.mjs'), 'export const old = a => a > 1;\nexport const added = a => a < 9;\n'); sh(d, 'add', '-A'); sh(d, 'commit', '-q', '-m', 'task');
  writeFileSync(join(d, 'src/new.mjs'), 'export const fresh = (a, b) => a && b;\n');                 // not added to git yet
  assert.deepEqual(m.changedLines(d, 'base'), { 'src/old.mjs': [2], 'src/new.mjs': [1, 2] });
});

test('run: says so when there is nothing to try, no test command, or the tests already fail', () => {
  const docs = repo({ 'notes.md': 'a > b\n' });
  assert.deepEqual((({ ok, note }) => ({ ok, note }))(m.run(docs, { base: 'main', test: 'node -e 0', print: () => {} })), { ok: true, note: 'nothing to mutate' });
  const code = repo({ 'src/calc.mjs': CALC });
  assert.deepEqual((({ ok, note }) => ({ ok, note }))(m.run(code, { base: 'main', test: '', print: () => {} })), { ok: false, note: 'no test command' });
  assert.deepEqual((({ ok, note }) => ({ ok, note }))(m.run(code, { base: 'main', test: 'node -e "process.exit(1)"', print: () => {} })), { ok: false, note: 'baseline fails' });
  assert.equal(readFileSync(join(code, 'src/calc.mjs'), 'utf8'), CALC);
});

test('restorePending puts back a file an interrupted run left mutated', () => {
  const d = repo({ 'src/calc.mjs': CALC });
  const j = join(sh(d, 'rev-parse', '--absolute-git-dir'), 'bridgie-mutation.json');
  writeFileSync(j, JSON.stringify({ file: 'src/calc.mjs', original: CALC }));
  writeFileSync(join(d, 'src/calc.mjs'), CALC.replace('>=', '>'));
  assert.equal(m.restorePending(d), 'src/calc.mjs');
  assert.equal(readFileSync(join(d, 'src/calc.mjs'), 'utf8'), CALC);
  assert.ok(!existsSync(j));
  assert.equal(m.restorePending(d), null);
});
