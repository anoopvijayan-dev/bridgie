// bridgie learn <slug> — the retro seat proposes tests, rules, gotchas and policy changes.
// Nothing is applied: proposals land in .bridgie/learn/ for a human to adopt.
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as st from '../state.mjs';
import { runSeat } from '../cli/seat.mjs';
import { die, log, projectRoot, stateCommit, betStatus, today, rel } from '../cli/core.mjs';

export default async function learn(argv) {
  const slug = argv[0];
  if (!slug) die('usage: bridgie learn <slug>');
  const root = projectRoot();
  const status = betStatus(root, slug);
  const af = join(root, '.bridgie', 'acceptance', `${slug}.md`);
  const decided = existsSync(af) ? st.readFm(af).data.decision : '';
  if (!(status === 'killed' || (decided && decided !== 'pending'))) die(`learn: '${slug}' has no outcome yet (needs an accept decision, or a killed bet)`);
  const runDir = await runSeat(slug, 'learn/retro', { root });
  const o = st.readJson(join(runDir, 'seat-output.json'));
  const out = join(root, '.bridgie', 'learn', `proposals-${today()}-${slug}.md`);
  const lines = [`# Learn — ${slug} (${today()})`, '', o.summary_md, '', '## Proposals (not applied)', ''];
  for (const p of o.proposals || []) lines.push(`- [ ] **${p.kind}**: ${p.text}`);
  lines.push('', 'Adopt a gotcha by adding it to .bridgie/learn/gotchas.md; tests and rules go in the code; policy changes in .bridgie/policy.yaml.', '');
  writeFileSync(out, lines.join('\n'));
  stateCommit(root, `learn ${slug}`);
  log(`proposals written to ${rel(root, out)}`);
}
