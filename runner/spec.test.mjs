import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as sp from './spec.mjs';

const LIVING = `# Living spec\n\nintro\n\n## card-fees.R1 · event · risk: money\nWHEN a customer pays by card\nTHE SYSTEM SHALL add a 2% fee.\nSource: card-fees (2026-11-20)\n\n## card-fees.R2 · ubiquitous · risk: none\nTHE SYSTEM SHALL show the fee.\nSource: card-fees (2026-11-20)\n\n## card-fees.P1 · property\nFor any payment the fee SHALL be at most 2%.\nValidates: card-fees.R1\nSource: card-fees (2026-11-20)\n`;
const BET = `# Requirements — Fee cap\n\n## R1 · event · risk: money\nChanges: card-fees.R1\nWHEN a customer pays by card\nTHE SYSTEM SHALL add a 2% fee, capped at 5.00.\n\n## R2 · event · risk: none\nWHEN the cap applies THE SYSTEM SHALL say so, as R1 and card-fees.R2 describe.\n\n## P1 · property\nFor any payment the fee SHALL be at most 5.00.\nValidates: R1\n\n## Removed\n- card-fees.R2: the receipt line replaces it.\n`;

test('parseLiving reads ids, headings, text and the runner lines; render round-trips', () => {
  const l = sp.parseLiving(LIVING);
  assert.deepEqual(l.map(r => r.id), ['card-fees.R1', 'card-fees.R2', 'card-fees.P1']);
  assert.equal(l[0].head, ' · event · risk: money');
  assert.deepEqual(l[0].text, ['WHEN a customer pays by card', 'THE SYSTEM SHALL add a 2% fee.']);
  assert.deepEqual(l[0].meta, ['Source: card-fees (2026-11-20)']);
  assert.deepEqual(sp.parseLiving(sp.renderLiving(l)), l);
  assert.deepEqual(sp.parseLiving(''), []);
});

test('parseDelta: Changes lines, Removed section, new requirements', () => {
  const d = sp.parseDelta(BET);
  assert.deepEqual(d.reqs.map(r => [r.local, r.changes]), [['R1', 'card-fees.R1'], ['R2', null], ['P1', null]]);
  assert.deepEqual(d.reqs[0].text, ['WHEN a customer pays by card', 'THE SYSTEM SHALL add a 2% fee, capped at 5.00.']);
  assert.deepEqual(d.removed, [{ id: 'card-fees.R2', reason: 'the receipt line replaces it.' }]);
  assert.deepEqual(d.errors, []);
});

test('checkDelta refuses unknown ids, double claims, missing reasons and malformed lines', () => {
  const l = sp.parseLiving(LIVING);
  assert.deepEqual(sp.checkDelta(sp.parseDelta(BET), l), []);
  const bad = sp.parseDelta(`## R1 · event · risk: none\nChanges: card-fees.R9\nx\n\n## R2 · event · risk: none\nChanges: card-fees.R1\ny\n\n## R3 · event · risk: none\nChanges: card-fees.R1\nz\n\n## Removed\n- card-fees.R1: gone\n- card-fees.P1:\nnot a bullet\n`);
  const errs = sp.checkDelta(bad, l).join('\n');
  assert.match(errs, /R1: "Changes: card-fees\.R9" names no requirement in the living spec/);
  assert.match(errs, /card-fees\.R1 is changed by R2 and changed by R3/);
  assert.match(errs, /card-fees\.R1 is changed by R2 and removed/);
  assert.match(errs, /card-fees\.P1 needs a reason/);
  assert.match(errs, /"not a bullet" is not "- <living id>: <reason>"/);
});

test('applyDelta: changes keep the id, removals go, new ones get <slug>.<id>, local references become living ids', () => {
  const res = sp.applyDelta(sp.parseLiving(LIVING), sp.parseDelta(BET), 'fee-cap', '2026-12-02');
  assert.deepEqual(res.reqs.map(r => r.id), ['card-fees.R1', 'card-fees.P1', 'fee-cap.R2', 'fee-cap.P1']);
  const r1 = res.reqs[0];
  assert.equal(r1.text[1], 'THE SYSTEM SHALL add a 2% fee, capped at 5.00.');
  assert.deepEqual(r1.meta, ['Source: card-fees (2026-11-20)', 'Changed by: fee-cap (2026-12-02)']);
  assert.equal(res.reqs[2].text[0], 'WHEN the cap applies THE SYSTEM SHALL say so, as card-fees.R1 and card-fees.R2 describe.');
  assert.equal(res.reqs[3].text[1], 'Validates: card-fees.R1');
  assert.deepEqual(res.reqs[3].meta, ['Source: fee-cap (2026-12-02)']);
  assert.deepEqual(res.added.map(r => r.id), ['fee-cap.R2', 'fee-cap.P1']);
  assert.deepEqual(res.changed.map(c => [c.id, c.local]), [['card-fees.R1', 'R1']]);
  assert.deepEqual(res.removed.map(x => x.id), ['card-fees.R2']);
  assert.match(sp.changesMarkdown(res), /Removed[\s\S]*card-fees\.R2: the receipt line replaces it\./);
});

test('applying to the same base twice gives the same file', () => {
  const base = sp.parseLiving(LIVING), d = sp.parseDelta(BET);
  assert.equal(sp.renderLiving(sp.applyDelta(base, d, 'fee-cap', '2026-12-02').reqs), sp.renderLiving(sp.applyDelta(base, d, 'fee-cap', '2026-12-02').reqs));
});

test('seed applies delivered bets oldest first; a bet whose delta does not fit is added whole, with a warning', () => {
  const first = `## R1 · event · risk: money\nWHEN a customer pays by card\nTHE SYSTEM SHALL add a 2% fee.\n\n## R2 · ubiquitous · risk: none\nTHE SYSTEM SHALL show the fee.\n`;
  const s = sp.seed([{ slug: 'card-fees', date: '2026-11-20', text: first }, { slug: 'fee-cap', date: '2026-12-02', text: BET }]);
  assert.deepEqual(s.reqs.map(r => r.id), ['card-fees.R1', 'fee-cap.R2', 'fee-cap.P1']);
  assert.deepEqual(s.warnings, []);
  const odd = sp.seed([{ slug: 'fee-cap', date: '2026-12-02', text: BET }]);
  assert.deepEqual(odd.reqs.map(r => r.id), ['fee-cap.R1', 'fee-cap.R2', 'fee-cap.P1']);
  assert.match(odd.warnings[0], /^fee-cap: /);
});
