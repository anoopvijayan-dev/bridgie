// bridgie plan <slug> — decomposer turns the approved design into tasks.json.
import { basename, join } from 'node:path';
import * as fl from '../flow.mjs';
import { runSeat } from '../cli/seat.mjs';
import { die, log, projectRoot, stateCommit } from '../cli/core.mjs';

export default async function plan(argv) {
  const slug = argv[0];
  if (!slug) die('usage: bridgie plan <slug>');
  const root = projectRoot();
  if (!fl.designApproved(root, slug)) die(`plan: the design for '${slug}' is not approved (bridgie open ${slug})`);
  const runDir = await runSeat(slug, 'build/decomposer', { root });
  let doc;
  try { doc = fl.writeTasksFromPlan(root, slug, join(runDir, 'seat-output.json')); } catch (e) { die(`${e.message}\nplan: decomposer output rejected; see ${runDir}`); }
  stateCommit(root, `plan ${slug} (${basename(runDir)})`);
  log(`planned ${slug}: ${doc.tasks.length} task(s). Next: bridgie build ${slug}   (or bridgie run ${slug})`);
}
