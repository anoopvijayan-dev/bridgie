// bridgie numbers <slug> [--template] — unit economics computed from .bridgie/bets/<slug>/numbers.yaml.
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TEMPLATE, writeNumbers } from '../numbers.mjs';
import { die, log, parseArgs, projectRoot, stateCommit, betStatus } from '../cli/core.mjs';

export default async function numbers(argv) {
  const a = parseArgs(argv, { template: 'bool' }, 'numbers');
  const slug = a._[0];
  if (!slug) die('usage: bridgie numbers <slug> [--template]');
  const root = projectRoot();
  betStatus(root, slug);
  const dir = join(root, '.bridgie', 'bets', slug);
  if (a.template) {
    if (existsSync(join(dir, 'numbers.yaml'))) die(`numbers: ${join(dir, 'numbers.yaml')} already exists; edit it, then run bridgie numbers ${slug}`);
    writeFileSync(join(dir, 'numbers.yaml'), TEMPLATE);
    log(`wrote .bridgie/bets/${slug}/numbers.yaml with example figures. Replace them with yours, then: bridgie numbers ${slug}`);
    return;
  }
  let c;
  try { c = writeNumbers(root, slug); } catch (e) { die(e.message); }
  stateCommit(root, `numbers ${slug}`);
  if (c.verdict === 'profitable') log(`numbers: profitable on these inputs — contribution ${c.contribution_per_unit}/unit, break-even ${c.break_even_units_per_day}/day, margin ${c.margin_at_plan}, payback month ${c.payback_month}. See .bridgie/bets/${slug}/numbers.md`);
  else log(`numbers: not yet — failing ${JSON.stringify(c.failing)}. See .bridgie/bets/${slug}/numbers.md`);
}
