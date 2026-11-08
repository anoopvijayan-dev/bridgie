// Unit economics for a bet, computed from the owner's numbers.yaml. Every figure traces to an input;
// a missing input is an error, never a guess. The verdict is computed from the checks, never written.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse as yparse } from './yaml.mjs';
import * as st from './state.mjs';
import { validate } from './schema.mjs';

const r2 = x => Math.round(x * 100) / 100;

export function loadNumbers(file) {
  if (!existsSync(file)) throw new Error(`no ${file}; write it from the template: bridgie numbers <slug> --template`);
  const n = yparse(readFileSync(file, 'utf8'));
  const errs = validate(st.loadSchema('numbers'), n);
  if (errs.length) throw new Error(`${file}: ${errs.join('; ')}`);
  if (n.price <= 0) throw new Error('price must be positive');
  if (n.units_per_day_plan <= 0 || n.days_per_month <= 0) throw new Error('units_per_day_plan and days_per_month must be positive');
  return { ramp_months: 6, what_ifs: null, capacity_units_per_day: null, ...n };
}

// compute: contribution, break-even, margin at plan, year 1 by month with a linear ramp, cash needed,
// payback month, what-ifs, checks and the verdict.
export function compute(n) {
  const contribution = n.price - n.variable_cost;
  const perMonth = units => ({ revenue: n.price * units * n.days_per_month, profit: contribution * units * n.days_per_month - n.fixed_costs_monthly });
  const breakEven = contribution > 0 ? n.fixed_costs_monthly / (contribution * n.days_per_month) : null;
  const plan = perMonth(n.units_per_day_plan);
  const margin = plan.revenue > 0 ? plan.profit / plan.revenue : null;
  const ramp = Math.max(1, n.ramp_months);
  const year1 = []; let cumulative = -n.startup_spend, worst = cumulative, payback = null;
  for (let m = 1; m <= 12; m++) {
    const units = m >= ramp ? n.units_per_day_plan : r2(n.units_per_day_plan * m / ramp);
    const { revenue, profit } = perMonth(units);
    cumulative += profit;
    if (cumulative < worst) worst = cumulative;
    if (payback === null && cumulative >= 0) payback = m;
    year1.push({ month: m, units_per_day: units, revenue: r2(revenue), operating_profit: r2(profit), cumulative: r2(cumulative) });
  }
  const year1Profit = year1.reduce((s, m) => s + m.operating_profit, 0);
  const whatIfs = (n.what_ifs || [
    { name: 'price −10%', price: n.price * 0.9 },
    { name: 'units −20%', units_per_day_plan: n.units_per_day_plan * 0.8 },
    { name: 'variable cost +15%', variable_cost: n.variable_cost * 1.15 },
  ]).map(w => {
    const m = { ...n, ...w, what_ifs: [] };
    const c = m.price - m.variable_cost;
    const y = Array.from({ length: 12 }, (_, i) => { const mo = i + 1; const u = mo >= ramp ? m.units_per_day_plan : m.units_per_day_plan * mo / ramp; return c * u * m.days_per_month - m.fixed_costs_monthly; }).reduce((a, b) => a + b, 0);
    return { name: w.name, contribution_per_unit: r2(c), break_even_units_per_day: c > 0 ? r2(m.fixed_costs_monthly / (c * m.days_per_month)) : null, year1_operating_profit: r2(y) };
  });
  const checks = {
    unit_positive: contribution > 0,
    year1_positive: year1Profit > 0,
    fits_capacity: n.capacity_units_per_day ? (breakEven !== null && breakEven <= n.capacity_units_per_day) : null,
  };
  const failing = Object.entries(checks).filter(([, v]) => v === false).map(([k]) => k);
  return {
    currency: n.currency, inputs: n,
    contribution_per_unit: r2(contribution), break_even_units_per_day: breakEven === null ? null : r2(breakEven),
    margin_at_plan: margin === null ? null : r2(margin), year1, year1_operating_profit: r2(year1Profit),
    cash_needed: r2(Math.max(0, -worst)), payback_month: payback, what_ifs: whatIfs, checks,
    verdict: failing.length ? 'not_yet' : 'profitable', failing,
  };
}

export function render(slug, c) {
  const cur = c.currency, pct = x => (x === null ? '—' : `${Math.round(x * 100)}%`), f = x => (x === null ? '—' : `${cur} ${x.toLocaleString('en-GB')}`);
  const verdict = c.verdict === 'profitable' ? 'Profitable on these inputs' : `Not yet — failing: ${c.failing.join(', ')}`;
  return [`# Numbers — ${slug}`, '', `**${verdict}** (computed ${st.today()} from \`numbers.yaml\`; every figure traces to an input; estimates are the owner's)`, '',
    '| Contribution per unit | Break-even units/day | Margin at plan | Year 1 operating profit | Cash needed | Payback |', '|---|---|---|---|---|---|',
    `| ${f(c.contribution_per_unit)} | ${c.break_even_units_per_day ?? '—'} | ${pct(c.margin_at_plan)} | ${f(c.year1_operating_profit)} | ${f(c.cash_needed)} | ${c.payback_month ? `month ${c.payback_month}` : 'not within year 1'} |`, '',
    '## Year 1 by month', '', '| Month | Units/day | Revenue | Operating profit | Cumulative (after startup spend) |', '|---|---|---|---|---|',
    ...c.year1.map(m => `| ${m.month} | ${m.units_per_day} | ${f(m.revenue)} | ${f(m.operating_profit)} | ${f(m.cumulative)} |`), '',
    '## What if', '', '| Case | Contribution | Break-even/day | Year 1 |', '|---|---|---|---|',
    ...c.what_ifs.map(w => `| ${w.name} | ${f(w.contribution_per_unit)} | ${w.break_even_units_per_day ?? '—'} | ${f(w.year1_operating_profit)} |`), '',
    '## Checks', '', ...Object.entries(c.checks).map(([k, v]) => `- ${v === null ? '○' : v ? '✓' : '✗'} ${k}${v === null ? ' (no input)' : ''}`), '',
    '## Inputs', '', '```yaml', ...Object.entries(c.inputs).filter(([k, v]) => v !== null && k !== 'what_ifs').map(([k, v]) => `${k}: ${JSON.stringify(v)}`), '```', ''].join('\n');
}

export const TEMPLATE = `# Unit economics for this bet. Every field is required unless marked; Bridgie computes, never guesses.
currency: GBP
price: 39                 # what one unit sells for (one application, one month, one seat…)
variable_cost: 4          # cost that only exists when a unit is sold (API calls, payment fees, materials)
fixed_costs_monthly: 2500 # costs that exist whether or not you sell (salaries, hosting, rent)
units_per_day_plan: 8     # the plan: units sold per day once ramped
days_per_month: 22
startup_spend: 6000       # one-off spend before the first sale
ramp_months: 6            # optional (default 6): months to reach the plan, linear from 1/ramp
# capacity_units_per_day: 20   # optional: the most you can deliver in a day; break-even must fit inside it
# what_ifs:                    # optional: override the default three cases
#   - { name: "price −10%", price: 35 }
`;

export function writeNumbers(root, slug) {
  const dir = join(root, '.bridgie', 'bets', slug);
  const c = compute(loadNumbers(join(dir, 'numbers.yaml')));
  writeFileSync(join(dir, 'numbers.json'), JSON.stringify({ bet: slug, date: st.today(), ...c }, null, 2) + '\n');
  writeFileSync(join(dir, 'numbers.md'), render(slug, c));
  return c;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [op, ...a] = process.argv.slice(2);
  try {
    if (op === 'write') { const c = writeNumbers(a[0], a[1]); process.stdout.write(JSON.stringify({ verdict: c.verdict, failing: c.failing, contribution: c.contribution_per_unit, break_even: c.break_even_units_per_day, margin: c.margin_at_plan, payback: c.payback_month }) + '\n'); }
    else if (op === 'template') { process.stdout.write(TEMPLATE); }
    else throw new Error(`unknown op "${op}"`);
  } catch (e) { console.error(`numbers.mjs: ${e.message}`); process.exit(1); }
}
