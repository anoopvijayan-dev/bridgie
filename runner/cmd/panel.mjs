// bridgie panel <slug> [--n N | --quick] [--seed S]
// 1st run: the profiler drafts customer.yaml and pitch.md beside the bet, then stops for the owner.
// 2nd run: the runner deals N persona cards, one fresh buyer agent plays each, the runner tallies.
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as st from '../state.mjs';
import { loadCustomer, deal, writePanel } from '../panel.mjs';
import { runSeat, runSwarm } from '../cli/seat.mjs';
import { die, log, waitHuman, parseArgs, projectRoot, stateCommit } from '../cli/core.mjs';
import { decideStatusOk } from './research.mjs';

export default async function panel(argv) {
  const a = parseArgs(argv, { n: 'value', quick: 'bool', seed: 'value' }, 'panel');
  const slug = a._[0];
  if (!slug) die('usage: bridgie panel <slug> [--n N | --quick] [--seed S]');
  const root = projectRoot();
  const bdir = join(root, '.bridgie', 'bets', slug);
  decideStatusOk(root, slug, 'panel');
  const pol = st.loadPolicy(root).swarm || {};
  const n = a.quick ? 20 : a.n !== undefined ? Number(a.n) : (pol.default_n || 20);
  const max = pol.max_n || 100, seed = Number(a.seed || 1);
  if (!Number.isInteger(n) || n < 1) die('panel: --n must be a positive integer');
  if (n > max) die(`panel: ${n} buyers is above the policy ceiling swarm.max_n=${max}`);

  if (!existsSync(join(bdir, 'customer.yaml')) || !existsSync(join(bdir, 'pitch.md'))) {
    const runDir = await runSeat(slug, 'decide/profiler', { root });
    const f = st.readJson(join(runDir, 'seat-output.json')).files || {};
    if (!f['customer.yaml'] || !f['pitch.md']) die(`profiler output has no files[customer.yaml] / files[pitch.md]\npanel: profiler output rejected (see ${runDir})`);
    writeFileSync(join(bdir, 'customer.yaml'), f['customer.yaml']);
    writeFileSync(join(bdir, 'pitch.md'), f['pitch.md']);
    try { deal(loadCustomer(join(bdir, 'customer.yaml')), 1); } catch (e) { die(`${e.message}\npanel: the drafted customer.yaml does not validate; fix it by hand (see ${runDir})`); }
    stateCommit(root, `panel ${slug}: profile drafted`);
    waitHuman(`panel: drafted .bridgie/bets/${slug}/customer.yaml and pitch.md. Review and correct them (a wrong customer makes the whole panel wrong), then run bridgie panel ${slug} again`);
  }

  const runs = join(root, '.bridgie', 'runs', slug); mkdirSync(runs, { recursive: true });
  const k = readdirSync(runs).filter(d => d.startsWith('panel-') && statSync(join(runs, d)).isDirectory()).length + 1;
  const pdir = join(runs, `panel-${String(k).padStart(2, '0')}`); mkdirSync(pdir, { recursive: true });
  let dealt;
  try { dealt = deal(loadCustomer(join(bdir, 'customer.yaml')), n, seed); } catch (e) { die(`${e.message}\npanel: customer.yaml does not validate`); }
  writeFileSync(join(pdir, 'cards.json'), JSON.stringify(dealt, null, 2) + '\n');
  log(`panel: ${n} buyers dealt (seed ${seed}); running one buyer agent per card`);
  const { ok, failed } = await runSwarm(slug, 'decide/buyer', join(pdir, 'cards.json'), join(pdir, 'buyers'), { root });
  log(`panel: ${ok} buyer run(s) finished, ${failed} failed twice and are excluded`);
  let t;
  try { t = writePanel(root, slug, join(pdir, 'cards.json'), join(pdir, 'buyers')); } catch (e) { die(`${e.message}\npanel: nothing to tally (see ${pdir})`); }
  stateCommit(root, `panel ${slug} (panel-${String(k).padStart(2, '0')})`);
  log(`panel: buy rate ${t.buy_rate} over ${t.answered} answers (${t.excluded.length} excluded). Simulated buyers: an upper bound, not evidence. Read it: bridgie open ${slug}`);
}
