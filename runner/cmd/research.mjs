// bridgie research <slug> — competitors, substitutes, prices and complaints from the web, every fact linked.
import { basename, join } from 'node:path';
import * as st from '../state.mjs';
import { writeResearch, stopped } from '../decide.mjs';
import { runSeat } from '../cli/seat.mjs';
import { die, log, projectRoot, stateCommit, betStatus, waitHuman } from '../cli/core.mjs';

// decideStatusOk: the decide loop works on draft, grilling and evidence bets only.
export function decideStatusOk(root, slug, cmd) {
  const s = betStatus(root, slug);
  if (!['draft', 'grilling', 'evidence'].includes(s)) die(`${cmd}: bet '${slug}' is '${s}'; the decide loop is closed`);
}

// stopIfAsked: when the seat stopped to ask the owner something, raise its questions, commit, and wait (exit 3).
export function stopIfAsked(root, slug, runDir, cmd) {
  const out = join(runDir, 'seat-output.json');
  if (!stopped(out)) return;
  const ids = st.ingestQuestions(root, slug, out, basename(runDir));
  stateCommit(root, `${cmd} ${slug} stopped for the owner (${basename(runDir)})`);
  waitHuman(`${cmd}: the seat stopped to ask first: ${ids.join(', ')}. Answer on bridgie open ${slug} (or bridgie decide ${slug} ${ids[0]} ...), then run bridgie ${cmd} ${slug} again`);
}

export default async function research(argv) {
  const slug = argv[0];
  if (!slug) die('usage: bridgie research <slug>');
  const root = projectRoot();
  decideStatusOk(root, slug, 'research');
  const runDir = await runSeat(slug, 'decide/researcher', { root });
  stopIfAsked(root, slug, runDir, 'research');
  let res;
  try { res = writeResearch(root, slug, join(runDir, 'seat-output.json')); } catch (e) { die(`${e.message}\nresearch: output rejected (see ${runDir})`); }
  st.ingestQuestions(root, slug, join(runDir, 'seat-output.json'), basename(runDir));
  stateCommit(root, `research ${slug} (${basename(runDir)})`);
  log(`research written to .bridgie/bets/${slug}/research.md (${res.links} sources). Read it: bridgie open ${slug}`);
}
