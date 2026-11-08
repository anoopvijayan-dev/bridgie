// bridgie accept <slug> [--approve | --conditions "<conditions>" | --reject "<reason>"]
// Without flags: packages the acceptance page (R6: every task passed). With a flag: answers it.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as st from '../state.mjs';
import * as fl from '../flow.mjs';
import { runSeat } from '../cli/seat.mjs';
import * as g from '../cli/git.mjs';
import { die, log, parseArgs, projectRoot, stateCommit, user, git } from '../cli/core.mjs';

export default async function accept(argv) {
  const a = parseArgs(argv, { approve: 'bool', conditions: 'value', reject: 'value' }, 'accept');
  const slug = a._[0];
  if (!slug) die('usage: bridgie accept <slug> [--approve | --conditions "..." | --reject "..."]');
  const root = projectRoot();
  const ans = a.approve ? 'approve' : a.conditions !== undefined ? 'approve with conditions' : a.reject !== undefined ? 'reject' : null;
  const pending = () => st.listDecisions(root, slug, { pending: true }).filter(d => d.type === 'accept').map(d => d.id);

  if (ans) {
    const id = pending()[0];
    if (!id) die(`accept: nothing waiting for acceptance on '${slug}' (run bridgie accept ${slug} first)`);
    let res;
    try { res = fl.answer(root, slug, id, ans, { by: user(), text: a.conditions ?? a.reject, gitSha: fl.featureSha(root, slug) || undefined }); } catch (e) { die(e.message); }
    stateCommit(root, `accept ${slug}: ${ans}`);
    log(`${id} → ${ans}: ${res?.effect || ''}`);
    return;
  }

  if (!fl.allPassed(root, slug)) die(`accept: every task of '${slug}' must pass first (R6); see bridgie status`);
  if (pending().length) {
    const f = fl.acceptancePath(root, slug);
    const stale = existsSync(f) ? fl.stalePackage(root, slug, st.readFm(f).data) || '' : 'no package';
    if (!stale) die(`accept: '${slug}' is already waiting for a decision (bridgie open ${slug})`);
    log(`the previous acceptance package is stale (${stale}); building a new one`);
  }
  g.onFeature(root, slug);
  const base = git(['-C', root, 'config', `branch.bridgie/${slug}.bridgieBase`]).out.trim() || 'main';
  const packet = mkdtempSync(join(tmpdir(), 'bridgie-accept-'));
  try {
    const diffStat = g.diffStat(root, base, `bridgie/${slug}`);
    writeFileSync(join(packet, 'diff-stat.txt'), diffStat ? `${diffStat}\n` : '');
    const { md, cost } = fl.acceptancePacket(root, slug, diffStat);
    writeFileSync(join(packet, 'acceptance-packet.md'), md);
    const runDir = await runSeat(slug, 'accept/packager', { root, packet });
    try {
      const o = st.readJson(join(runDir, 'seat-output.json'));
      const body = o.artifact_md || o.summary_md;
      const sec = body.split(/^## /m).find(x => /^residual uncertainty/i.test(x)) || '';
      const residual = sec.split('\n').filter(l => /^\s*-\s+/.test(l)).map(l => l.replace(/^\s*-\s+/, '').trim());
      fl.writeAcceptance(root, slug, { body, residual, cost });
    } catch (e) { die(`${e.message}\naccept: packager output rejected`); }
  } finally { rmSync(packet, { recursive: true, force: true }); }
  stateCommit(root, `accept ${slug}: packaged`);
  log(`acceptance package ready for ${slug}. Decide: bridgie open ${slug}   (or: bridgie accept ${slug} --approve)`);
}
