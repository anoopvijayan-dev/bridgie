// bridgie grill <slug> [--lenses] — stress-test the bet's why; questions become decisions.
import { basename, join } from 'node:path';
import * as st from '../state.mjs';
import { runSeat } from '../cli/seat.mjs';
import { die, log, parseArgs, projectRoot, stateCommit, betStatus } from '../cli/core.mjs';
import lenses from './lenses.mjs';

export default async function grill(argv) {
  const a = parseArgs(argv, { lenses: 'bool' }, 'grill');
  const slug = a._[0];
  if (!slug) die('usage: bridgie grill <slug> [--lenses]');
  const root = projectRoot();
  const status = betStatus(root, slug);
  if (!['draft', 'evidence'].includes(status)) die(`grill: bet '${slug}' is '${status}'; only draft or evidence bets can be grilled`);
  st.betTransition(root, slug, 'grilling');
  let runDir;
  try { runDir = await runSeat(slug, 'decide/grill', { root }); }
  catch (e) {
    try { st.betTransition(root, slug, status); } catch { /* best effort */ }
    die(`${e.message}\ngrill: seat run failed; bet '${slug}' returned to '${status}'`);
  }
  const ids = st.ingestQuestions(root, slug, join(runDir, 'seat-output.json'), basename(runDir));
  st.ensureSignDecision(root, slug);
  st.betTransition(root, slug, 'evidence');
  stateCommit(root, `grill ${slug} (${basename(runDir)})`);
  log(`grill ${slug}: ${ids.length} question(s) raised, sign decision ready. Answer them with: bridgie open ${slug}   (or: bridgie decide ${slug} <id> <answer>)`);
  if (a.lenses) await lenses([slug]);
}
