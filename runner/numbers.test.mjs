import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as nm from './numbers.mjs';

// The matcha example from founder-skill: $6.50 a cup, $1.74 variable, $23,000 fixed a month, 383 cups a day, 30 days, $25,280 startup.
const matcha = { currency: 'CAD', price: 6.5, variable_cost: 1.74, fixed_costs_monthly: 23000, units_per_day_plan: 383, days_per_month: 30, startup_spend: 25280, ramp_months: 6, what_ifs: null, capacity_units_per_day: null };

test('matcha: contribution 4.76, break-even 186/day, margin 38%, payback within year 1', () => {
  const c = nm.compute(matcha);
  assert.equal(c.contribution_per_unit, 4.76);
  assert.equal(Math.round(c.break_even_units_per_day), 161);          // 23000 / (4.76 × 30)
  assert.equal(Math.round(c.margin_at_plan * 100), 42);               // (4.76×383×30 − 23000) / (6.5×383×30)
  assert.ok(c.payback_month >= 4 && c.payback_month <= 8, `payback ${c.payback_month}`);
  assert.equal(c.verdict, 'profitable');
  assert.equal(c.year1.length, 12);
  assert.equal(c.year1[5].units_per_day, 383);                        // ramped by month 6
  assert.equal(c.what_ifs.length, 3);
  assert.ok(c.cash_needed > 25280, 'cash need includes the early losses');
});

test('not_yet when a unit loses money; capacity check when given', () => {
  const c = nm.compute({ ...matcha, variable_cost: 7 });
  assert.equal(c.verdict, 'not_yet');
  assert.deepEqual(c.failing, ['unit_positive', 'year1_positive']);
  assert.equal(c.break_even_units_per_day, null);
  const d = nm.compute({ ...matcha, capacity_units_per_day: 100 });
  assert.equal(d.checks.fits_capacity, false);
  assert.deepEqual(d.failing, ['fits_capacity']);
});

test('loadNumbers refuses a missing field and never guesses', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nums-'));
  writeFileSync(join(dir, 'numbers.yaml'), 'currency: GBP\nvariable_cost: 1\nfixed_costs_monthly: 10\nunits_per_day_plan: 5\ndays_per_month: 20\nstartup_spend: 0\n');
  assert.throws(() => nm.loadNumbers(join(dir, 'numbers.yaml')), /price/);
  assert.throws(() => nm.loadNumbers(join(dir, 'missing.yaml')), /--template/);
  writeFileSync(join(dir, 'numbers.yaml'), nm.TEMPLATE);
  const n = nm.loadNumbers(join(dir, 'numbers.yaml'));
  assert.equal(n.price, 39); assert.equal(n.ramp_months, 6);
  assert.equal(nm.compute(n).verdict, 'profitable');
});
