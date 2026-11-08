// bridgie frame <slug> ["<one-line idea>"] — the framer drafts the bet body; assumptions become questions.
import { basename, join } from 'node:path';
import * as st from '../state.mjs';
import { addIdeaLine, applyFrame } from '../decide.mjs';
import { runSeat } from '../cli/seat.mjs';
import { die, log, projectRoot, stateCommit, betStatus } from '../cli/core.mjs';

export default async function frame(argv) {
  const [slug, idea] = argv;
  if (!slug) die('usage: bridgie frame <slug> ["<one-line idea>"]');
  const root = projectRoot();
  const status = betStatus(root, slug);
  if (status !== 'draft') die(`frame: bet '${slug}' is '${status}'; only a draft bet can be framed`);
  if (idea) addIdeaLine(root, slug, idea);
  const runDir = await runSeat(slug, 'decide/framer', { root });
  let replaced;
  try { replaced = applyFrame(root, slug, join(runDir, 'seat-output.json')); } catch (e) { die(`${e.message}\nframe: framer output rejected (see ${runDir})`); }
  const ids = st.ingestQuestions(root, slug, join(runDir, 'seat-output.json'), basename(runDir));
  stateCommit(root, `frame ${slug} (${basename(runDir)})`);
  log(`framed ${slug}: wrote ${replaced.join(', ')}; ${ids.length} assumption(s) raised as questions. Review: bridgie open ${slug}   then: bridgie grill ${slug}`);
}
