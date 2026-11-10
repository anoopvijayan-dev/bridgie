// bridgie research <slug> — competitors, substitutes, prices and complaints from the web, every fact linked.
import { basename, join } from 'node:path';
import * as st from '../state.mjs';
import { writeResearch, researchLinks, checkLinks, stopped } from '../decide.mjs';
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
  // The runner asks every link itself (BRIDGIE_NO_LINK_CHECK=1 skips this): a page that does not
  // exist cannot be a source, and the model is not the one to say whether it exists.
  let res;
  try {
    const out = join(runDir, 'seat-output.json');
    let check = null;
    if (process.env.BRIDGIE_NO_LINK_CHECK !== '1') {
      const links = researchLinks(out);
      log(`research: checking ${links.length} link(s)`);
      check = await checkLinks(links);
    }
    res = writeResearch(root, slug, out, check);
  } catch (e) { die(`${e.message}\nresearch: output rejected (see ${runDir})`); }
  st.ingestQuestions(root, slug, join(runDir, 'seat-output.json'), basename(runDir));
  stateCommit(root, `research ${slug} (${basename(runDir)})`);
  log(`research written to .bridgie/bets/${slug}/research.md (${res.links} sources${res.dead ? `, ${res.dead} of them dead links` : ''}). Read it: bridgie open ${slug}`);
}
