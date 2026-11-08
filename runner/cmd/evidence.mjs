// bridgie evidence <slug> — plan how each evidence task gets answered; with material in
// .bridgie/bets/<slug>/evidence/, synthesise it and raise a confidence proposal for the owner.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import * as st from '../state.mjs';
import * as fl from '../flow.mjs';
import { openEvidenceTasks, writeEvidence } from '../decide.mjs';
import { runSeat } from '../cli/seat.mjs';
import { die, log, projectRoot, stateCommit } from '../cli/core.mjs';
import { decideStatusOk, stopIfAsked } from './research.mjs';

export default async function evidence(argv) {
  const slug = argv[0];
  if (!slug) die('usage: bridgie evidence <slug>   (drop interview notes or exports in .bridgie/bets/<slug>/evidence/ first to synthesise)');
  const root = projectRoot();
  decideStatusOk(root, slug, 'evidence');
  const mat = join(root, '.bridgie', 'bets', slug, 'evidence');
  const mode = existsSync(mat) && readdirSync(mat).some(f => !f.startsWith('_') && statSync(join(mat, f)).isFile()) ? 'synthesis' : 'plan';
  if (mode === 'plan' && !openEvidenceTasks(root, slug).length) die(`evidence: '${slug}' has no open evidence tasks (answer a question with "don't know", or run bridgie panel) and no material in .bridgie/bets/${slug}/evidence/`);
  const runDir = await runSeat(slug, 'decide/evidence', { root });
  stopIfAsked(root, slug, runDir, 'evidence');
  let res;
  try { res = writeEvidence(root, slug, join(runDir, 'seat-output.json'), mode); } catch (e) { die(`${e.message}\nevidence: output rejected (see ${runDir})`); }
  st.ingestQuestions(root, slug, join(runDir, 'seat-output.json'), basename(runDir));
  const did = res.proposal ? fl.proposeConfidence(root, slug, res.proposal, { seat: 'evidence', run: basename(runDir) })?.id : null;
  stateCommit(root, `evidence ${slug} (${mode})`);
  if (mode === 'plan') log(`evidence plan for ${res.tasks} task(s) written to .bridgie/bets/${slug}/evidence-plan.md. Run it in the real world, drop the notes in .bridgie/bets/${slug}/evidence/, then bridgie evidence ${slug} again`);
  else if (did) log(`synthesis written to .bridgie/bets/${slug}/evidence-synthesis.md; confidence proposal raised as ${did} — accept or keep on bridgie open ${slug}`);
  else log(`synthesis written to .bridgie/bets/${slug}/evidence-synthesis.md; no confidence change proposed`);
}
