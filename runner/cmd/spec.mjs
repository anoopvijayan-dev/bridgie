// bridgie spec [--seed] — the living spec: every requirement accepted so far (.bridgie/spec/requirements.md).
// --seed builds it from the bets already delivered, oldest acceptance first.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as st from '../state.mjs';
import * as sp from '../spec.mjs';
import { die, log, parseArgs, projectRoot, rel, stateCommit } from '../cli/core.mjs';

export function deliveredSpecs(root) {
  return st.listBets(root).filter(s => ['delivered', 'evaluated'].includes(st.readFm(st.betPath(root, s)).data.status))
    .map(s => {
      const req = join(root, '.bridgie', 'specs', s, 'requirements.md'), acc = join(root, '.bridgie', 'acceptance', `${s}.md`);
      const at = existsSync(acc) ? String(st.readFm(acc).data.decided_at || '') : '';
      return existsSync(req) ? { slug: s, date: at.slice(0, 10) || 'date unknown', at, text: readFileSync(req, 'utf8') } : null;
    }).filter(Boolean).sort((a, b) => a.at.localeCompare(b.at) || a.slug.localeCompare(b.slug));
}

export default async function spec(argv) {
  const a = parseArgs(argv, { seed: 'bool' }, 'spec');
  const root = projectRoot();
  const f = sp.livingPath(root);
  if (a.seed) {
    if (existsSync(f)) die(`spec: ${rel(root, f)} already exists; it is updated at each accept`);
    const bets = deliveredSpecs(root);
    if (!bets.length) die('spec: no delivered bet with requirements to seed from');
    const { reqs, warnings } = sp.seed(bets);
    sp.writeLiving(root, reqs);
    for (const w of warnings) log(`warning: ${w}`);
    stateCommit(root, 'spec: seeded the living spec');
    log(`seeded ${rel(root, f)}: ${reqs.length} requirement(s) from ${bets.length} delivered bet(s) (${bets.map(b => b.slug).join(', ')}). Review it, then commit`);
    return;
  }
  if (!existsSync(f)) { log(`no living spec yet. It is written when a bet is packaged for acceptance${deliveredSpecs(root).length ? '; bridgie spec --seed builds one from the bets already delivered' : ''}`); return; }
  const reqs = sp.parseLiving(readFileSync(f, 'utf8'));
  const from = new Set(reqs.map(r => r.id.split('.')[0]));
  log(`${rel(root, f)}: ${reqs.length} requirement${reqs.length === 1 ? '' : 's'} from ${from.size} bet${from.size === 1 ? '' : 's'}`);
}
