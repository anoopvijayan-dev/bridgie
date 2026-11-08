// bridgie research <slug> — competitors, substitutes, prices and complaints from the web, every fact linked.
import { basename, join } from 'node:path';
import * as st from '../state.mjs';
import { writeResearch } from '../decide.mjs';
import { runSeat } from '../cli/seat.mjs';
import { die, log, projectRoot, stateCommit, betStatus } from '../cli/core.mjs';

// decideStatusOk: the decide loop works on draft, grilling and evidence bets only.
export function decideStatusOk(root, slug, cmd) {
  const s = betStatus(root, slug);
  if (!['draft', 'grilling', 'evidence'].includes(s)) die(`${cmd}: bet '${slug}' is '${s}'; the decide loop is closed`);
}

export default async function research(argv) {
  const slug = argv[0];
  if (!slug) die('usage: bridgie research <slug>');
  const root = projectRoot();
  decideStatusOk(root, slug, 'research');
  const runDir = await runSeat(slug, 'decide/researcher', { root });
  let res;
  try { res = writeResearch(root, slug, join(runDir, 'seat-output.json')); } catch (e) { die(`${e.message}\nresearch: output rejected (see ${runDir})`); }
  st.ingestQuestions(root, slug, join(runDir, 'seat-output.json'), basename(runDir));
  stateCommit(root, `research ${slug} (${basename(runDir)})`);
  log(`research written to .bridgie/bets/${slug}/research.md (${res.links} sources). Read it: bridgie open ${slug}`);
}
