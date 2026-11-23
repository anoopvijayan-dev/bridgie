// bridgie decide <slug> <id> <answer> [--text "free text"] [--relayed]
import * as fl from '../flow.mjs';
import { actor, die, log, parseArgs, projectRoot, stateCommit } from '../cli/core.mjs';

export default async function decide(argv) {
  const a = parseArgs(argv, { text: 'value', relayed: 'bool' }, 'decide');
  const [slug, id, answer] = a._;
  if (!slug || !id || !answer) die("usage: bridgie decide <slug> <id> <answer> [--text '...'] [--relayed]");
  const root = projectRoot();
  let res;
  try { res = fl.answer(root, slug, id, answer, { text: a.text, ...actor(a.relayed), gitSha: fl.featureSha(root, slug) || undefined }); } catch (e) { die(e.message); }
  stateCommit(root, `decide ${slug} ${id}: ${answer}`);
  log(`${id} → ${answer} (${res?.effect || ''})`);
}
