// bridgie decide <slug> <id> <answer> [--text "free text"]
import * as fl from '../flow.mjs';
import { die, log, parseArgs, projectRoot, stateCommit, user } from '../cli/core.mjs';

export default async function decide(argv) {
  const a = parseArgs(argv, { text: 'value' }, 'decide');
  const [slug, id, answer] = a._;
  if (!slug || !id || !answer) die("usage: bridgie decide <slug> <id> <answer> [--text '...']");
  const root = projectRoot();
  let res;
  try { res = fl.answer(root, slug, id, answer, { text: a.text, by: user(), gitSha: fl.featureSha(root, slug) || undefined }); } catch (e) { die(e.message); }
  stateCommit(root, `decide ${slug} ${id}: ${answer}`);
  log(`${id} → ${answer} (${res?.effect || ''})`);
}
