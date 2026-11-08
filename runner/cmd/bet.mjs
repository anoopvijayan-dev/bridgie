// bridgie bet new <slug> [--title T] [--lane L] [--risk R] [--from <scout>/O<n>]
import * as st from '../state.mjs';
import { seedBetFromOpportunity } from '../decide.mjs';
import { die, log, parseArgs, projectRoot, stateCommit, user, rel } from '../cli/core.mjs';

export default async function bet(argv) {
  const [sub, ...rest] = argv;
  if (sub !== 'new') die(`bet: expected 'new <slug>' (got '${sub || 'nothing'}')`);
  const a = parseArgs(rest, { title: 'value', lane: 'value', risk: 'value', from: 'value' }, 'bet new');
  const slug = a._[0];
  if (!slug) die('bet new: slug required');
  const root = projectRoot();
  const lane = a.lane || st.loadPolicy(root).default_lane || 'engineering';
  const risk = a.risk || 'none';
  let file;
  try { file = st.betNew(root, slug, { title: a.title || slug, lane, risk, owner: user() }); } catch (e) { die(e.message); }
  if (a.from) {
    try { seedBetFromOpportunity(root, slug, a.from); } catch (e) { die(e.message); }
    stateCommit(root, `bet new ${slug} (from ${a.from})`);
    log(`created ${rel(root, file)} from ${a.from} (lane: ${lane}, risk: ${risk}). Next: bridgie frame ${slug}`);
    return;
  }
  stateCommit(root, `bet new ${slug}`);
  log(`created ${rel(root, file)} (lane: ${lane}, risk: ${risk}). Fill in the body, then: bridgie frame ${slug} "<idea>"   or   bridgie grill ${slug}`);
}
