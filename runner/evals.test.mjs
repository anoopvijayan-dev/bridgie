import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as ev from './evals.mjs';

process.env.BRIDGIE_EVALS_HOME = mkdtempSync(join(tmpdir(), 'bridgie-evals-'));

test('the built-in cases load: every planted defect is found in its change, and there are clean cases too', () => {
  const cases = ev.loadCases();
  assert.ok(cases.length >= 12);
  const bugs = cases.filter(c => c.planted.length), clean = cases.filter(c => !c.planted.length);
  assert.ok(bugs.length >= 8 && clean.length >= 3, `${bugs.length} with a bug, ${clean.length} clean`);
  for (const c of cases) {
    assert.ok(c.requirements.includes('## R1'), c.name);
    assert.ok(c.task_requirements.length && c.claim && c.test, c.name);
    assert.ok(c.change.length, c.name);
    for (const p of c.planted) { assert.ok(p.line >= 1, c.name); new RegExp(p.about, 'i'); }
    assert.equal(c.name.startsWith('clean-'), c.planted.length === 0, `${c.name}: clean cases are named clean-`);
  }
  const fee = cases.find(c => c.name === 'fee-rounding');
  assert.equal(fee.planted[0].file, 'billing/fees.py');
  assert.throws(() => ev.loadCases(undefined, ['nope']), /no eval case "nope"/);
  assert.deepEqual(ev.loadCases(undefined, ['fee-rounding']).map(c => c.name), ['fee-rounding']);
});

test('scoreCase: a planted bug is caught only by a serious finding that names it; a clean change must pass with none', () => {
  const fee = ev.loadCases(undefined, ['fee-rounding'])[0], line = fee.planted[0].line;
  const f = (over = {}) => ({ severity: 'major', file: 'billing/fees.py', line, claim: 'x', repro: 'y', ...over });
  const score = findings => ev.scoreCase(fee, { verdict: 'fail', findings }).result;
  assert.equal(score([f()]), 'caught');                                              // the right place
  assert.equal(score([f({ line: line + 5 })]), 'caught');                            // within a few lines
  assert.equal(score([f({ line: 1, claim: 'round() rounds half to even, not half up' })]), 'caught');   // described in words
  assert.equal(score([f({ file: null, line: null, claim: 'banker rounding on a float' })]), 'caught');
  assert.equal(score([f({ file: '/abs/wt/billing/fees.py' })]), 'caught');           // a path with a prefix
  assert.equal(score([f({ severity: 'minor' })]), 'missed');                         // a minor note is not a catch
  assert.equal(score([f({ line: 1, claim: 'to_pence accepts negative input' })]), 'missed');            // failed it for another reason
  assert.equal(score([f({ file: 'tests/test_fees.py', line, claim: 'weak test' })]), 'missed');
  assert.equal(ev.scoreCase(fee, { verdict: 'pass', findings: [] }).result, 'missed');
  const other = ev.scoreCase(fee, { verdict: 'fail', findings: [f(), f({ line: 1, claim: 'something else' })] });
  assert.deepEqual({ result: other.result, serious: other.serious, other: other.other_serious }, { result: 'caught', serious: 2, other: 1 });

  const clean = ev.loadCases(undefined, ['clean-card-fee'])[0];
  assert.equal(ev.scoreCase(clean, { verdict: 'pass', findings: [] }).result, 'clean pass');
  assert.equal(ev.scoreCase(clean, { verdict: 'pass', findings: [f({ severity: 'minor' })] }).result, 'clean pass');
  assert.equal(ev.scoreCase(clean, { verdict: 'not_proven', findings: [] }).result, 'false alarm');
  assert.equal(ev.scoreCase(clean, { verdict: 'pass', findings: [f()] }).result, 'false alarm');
});

test('summarise and the stored calibration', () => {
  const s = ev.summarise([
    { planted: true, result: 'caught' }, { planted: true, result: 'missed' }, { planted: true, result: 'caught' },
    { planted: false, result: 'clean pass' }, { planted: false, result: 'false alarm' }, { planted: true, result: 'skipped' }, { planted: false, result: 'error' },
  ]);
  assert.deepEqual({ ran: s.ran, planted: s.planted, caught: s.caught, clean: s.clean, alarms: s.false_alarms, skipped: s.skipped, errors: s.errors }, { ran: 5, planted: 3, caught: 2, clean: 2, alarms: 1, skipped: 1, errors: 1 });
  assert.equal(s.recall, 2 / 3);
  assert.equal(ev.summaryText(s), 'caught 2 of 3 planted bugs; 1 false alarm on 2 clean changes');
  assert.equal(ev.summaryText(ev.summarise([])), 'no case could be run');
  assert.match(ev.calibrationText('codex'), /^codex: never tested with planted bugs \(bridgie eval reviewer --adapter codex\)$/);
  ev.saveRun({ adapter: 'codex', model: 'default', at: '2026-11-01T10:00:00Z', summary: ev.summarise([{ planted: true, result: 'missed' }]) });
  ev.saveRun({ adapter: 'codex', model: 'default', at: '2026-11-23T10:00:00Z', summary: s });
  ev.saveRun({ adapter: 'other', model: 'default', at: '2026-11-24T10:00:00Z', summary: ev.summarise([]) });      // nothing ran: not a calibration
  assert.equal(ev.calibrationText('codex'), 'codex: caught 2 of 3 planted bugs; 1 false alarm on 2 clean changes, tested 2026-11-23');
  assert.match(ev.calibrationText('other'), /never tested/);
});
