// bridgie accept <slug> [--approve | --conditions "<conditions>" | --reject "<reason>" | --override "<reason>"] [--relayed]
// Without flags: packages the acceptance page (R6: every task passed). With a flag: answers it.
// --override: the owner delivers with fewer approvals than policy asks for; the record says so.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as st from '../state.mjs';
import * as fl from '../flow.mjs';
import * as sp from '../spec.mjs';
import { runSeat } from '../cli/seat.mjs';
import * as g from '../cli/git.mjs';
import { requireGovernance } from './build.mjs';
import { actor, die, log, parseArgs, projectRoot, rel, stateCommit, git, today, waitHuman } from '../cli/core.mjs';

export default async function accept(argv) {
  const a = parseArgs(argv, { approve: 'bool', conditions: 'value', reject: 'value', override: 'value', relayed: 'bool' }, 'accept');
  const slug = a._[0];
  if (!slug) die('usage: bridgie accept <slug> [--approve | --conditions "..." | --reject "..." | --override "<reason>"] [--relayed]');
  const root = projectRoot();
  if (a.override !== undefined && !a.override.trim()) die('accept: --override needs the reason');
  const ans = a.approve || a.override !== undefined ? 'approve' : a.conditions !== undefined ? 'approve with conditions' : a.reject !== undefined ? 'reject' : null;
  const pending = () => st.listDecisions(root, slug, { pending: true }).filter(d => d.type === 'accept').map(d => d.id);

  if (ans !== 'reject') requireGovernance(root, slug, 'accept');
  if (ans) {
    const id = pending()[0];
    if (!id) die(`accept: nothing waiting for acceptance on '${slug}' (run bridgie accept ${slug} first)`);
    let res;
    try { res = fl.answer(root, slug, id, ans, { ...actor(a.relayed), text: a.conditions ?? a.reject, override: a.override, gitSha: fl.featureSha(root, slug) || undefined }); } catch (e) { die(e.message); }
    stateCommit(root, `accept ${slug}: ${a.override !== undefined ? 'owner override' : ans}`);
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
  // The living spec: an AI check that earlier requirements still hold (each serious finding is the
  // owner's to decide), then this bet's changes are merged into it, before anything is packaged.
  const check = await driftCheck(root, slug, base);
  const open = st.listDecisions(root, slug, { pending: true }).filter(d => d.type === 'spec_drift');
  if (open.length) waitHuman(`accept: ${open.length} living-spec (spec drift) finding(s) for you to decide first (${open.map(d => d.id).join(', ')}): bridgie open ${slug}`);
  let merged;
  try { merged = sp.mergeForBet(root, slug, today()); } catch (e) { die(`accept: ${e.message}; amend the design (bridgie shape ${slug} --amend "...")`); }
  const baseWarnings = baseMoved(root, slug, base, merged);
  for (const w of baseWarnings) log(`warning: ${w}`);
  const specMd = [sp.changesMarkdown(merged), ...baseWarnings.map(w => `\nWarning: ${w}`)].join('\n');
  const driftMd = check ? driftText(root, slug, check) : '';
  const packet = mkdtempSync(join(tmpdir(), 'bridgie-accept-'));
  try {
    const diffStat = g.diffStat(root, base, `bridgie/${slug}`);
    writeFileSync(join(packet, 'diff-stat.txt'), diffStat ? `${diffStat}\n` : '');
    const { md, cost } = fl.acceptancePacket(root, slug, diffStat);
    writeFileSync(join(packet, 'acceptance-packet.md'), `${md}\n## Living spec\n\n${specMd}\n${driftMd ? `\n## Spec drift\n\n${driftMd}\n` : ''}`);
    const runDir = await runSeat(slug, 'accept/packager', { root, packet });
    try {
      const o = st.readJson(join(runDir, 'seat-output.json'));
      // The runner, not the packager, writes what the bet does to the living spec: approvers sign it.
      const body = `${(o.artifact_md || o.summary_md).trimEnd()}\n\n## Spec changes\n\n${specMd}\n${driftMd ? `\n## Spec drift\n\n${driftMd}\n` : ''}`;
      const sec = body.split(/^## /m).find(x => /^residual uncertainty/i.test(x)) || '';
      const residual = sec.split('\n').filter(l => /^\s*-\s+/.test(l)).map(l => l.replace(/^\s*-\s+/, '').trim());
      fl.writeAcceptance(root, slug, { body, residual, cost });
    } catch (e) { die(`${e.message}\naccept: packager output rejected`); }
  } finally { rmSync(packet, { recursive: true, force: true }); }
  stateCommit(root, `accept ${slug}: packaged`);
  log(`acceptance package ready for ${slug}. Decide: bridgie open ${slug}   (or: bridgie accept ${slug} --approve)`);
}

// driftCheck: the spec-checker reads the bet's whole change against the living requirements it does
// not declare it changes or removes. Serious findings become spec_drift decisions. The result is kept
// and reused while the living spec before the bet, the bet's requirements and its diff are unchanged.
async function driftCheck(root, slug, base) {
  if (st.loadPolicy(root).living_spec?.drift_check === false) return null;
  const baseText = sp.ensureBase(root, slug), living = sp.parseLiving(baseText);
  const reqText = readFileSync(join(root, '.bridgie', 'specs', slug, 'requirements.md'), 'utf8');
  const delta = sp.parseDelta(reqText);
  const declared = new Set([...delta.reqs.map(r => r.changes).filter(Boolean), ...delta.removed.map(x => x.id)]);
  const earlier = living.filter(r => !declared.has(r.id)).map(r => r.id);
  if (!earlier.length) return null;
  const diff = g.betDiff(root, base, slug);
  const key = sp.digest(baseText, reqText, diff);
  const cacheFile = join(root, '.bridgie', 'specs', slug, 'spec-check.json');
  const cached = existsSync(cacheFile) ? st.readJson(cacheFile) : null;
  if (cached?.key === key) { log(`living-spec check: reusing ${cached.run} (nothing it read has changed)`); return cached; }
  const packet = mkdtempSync(join(tmpdir(), 'bridgie-spec-check-'));
  const wt = join(root, '.bridgie', 'worktrees', slug, 'spec-check');
  let runDir;
  try {
    writeFileSync(join(packet, 'living-base.md'), baseText);
    writeFileSync(join(packet, 'bet-diff.patch'), diff);
    const answers = fl.driftAnswers(root, slug);
    if (answers) writeFileSync(join(packet, 'drift-answers.md'), `${answers}\n`);
    g.detachedWorktree(root, `bridgie/${slug}`, wt);
    const producer = fl.loadTasks(root, slug).tasks.map(t => fl.producerVendor(root, slug, t.id)).find(Boolean) || '';
    let failure = null;
    try { runDir = await runSeat(slug, 'verify/spec-checker', { root, cwd: wt, packet, needsRepo: true, avoidVendor: fl.crossFamily(root, slug) ? producer : '' }); } catch (e) { failure = e; }
    const dirty = git(['-C', wt, 'status', '--porcelain']).out.trim();
    g.removeWorktree(root, wt);
    if (failure?.code === 3) die(`${failure.message}\naccept: the living-spec check did not run; nothing was packaged`, 3);
    if (failure) die(`${failure.message}\naccept: the living-spec check failed; nothing was packaged`);
    if (dirty) die('accept: the spec-checker changed files in its read-only worktree; its result is discarded');
  } finally { rmSync(packet, { recursive: true, force: true }); }
  const out = st.readJson(join(runDir, 'spec-check.json'));
  const findings = out.findings.filter(f => {
    if (earlier.includes(f.requirement)) return true;
    log(`living-spec check: ${f.requirement} is not an earlier living requirement this bet leaves alone; finding ignored`);
    return false;
  });
  for (const d of st.listDecisions(root, slug, { pending: true }).filter(x => x.type === 'spec_drift')) st.supersedeDecision(root, slug, d.id, 'superseded: the living-spec check ran again');
  const run = rel(root, runDir);
  const raised = [];
  for (const f of findings.filter(x => x.severity !== 'minor')) {
    const d = st.addDecision(root, slug, { type: 'spec_drift', allow_free_text: true, raised_by: { seat: 'spec-checker', run },
      context: `${f.requirement} may no longer hold (${f.severity}): ${f.claim}${f.file ? ` (${f.file}:${f.line ?? '?'})` : ''}. Amend the design so the bet changes or keeps it, or say why it still holds.`,
      options: ['amend the design', 'still holds'] });
    raised.push({ ...f, decision: d.id });
  }
  const rec = { key, run, at: st.now(), checked: earlier, findings: [...raised, ...findings.filter(x => x.severity === 'minor')] };
  writeFileSync(cacheFile, `${JSON.stringify(rec, null, 2)}\n`);
  stateCommit(root, `accept ${slug}: living-spec check`);
  log(`living-spec check: ${earlier.length} earlier requirement(s) read against the bet's change; ${findings.length} finding(s), ${raised.length} for you to decide`);
  return rec;
}

// driftText: every finding of the check, with the owner's answer for the ones that were decisions.
function driftText(root, slug, check) {
  if (!check.findings.length) return `The spec-checker (${check.run}) read ${check.checked.length} earlier requirement(s) against this bet's change and found no drift.`;
  const byId = Object.fromEntries(st.loadDecisions(root, slug).decisions.map(d => [d.id, d]));
  return [`The spec-checker (${check.run}) read ${check.checked.length} earlier requirement(s) against this bet's change:`, '',
    ...check.findings.map(f => {
      const d = f.decision && byId[f.decision];
      const ans = d ? ` → ${d.answer}${d.free_text ? `: ${d.free_text}` : ''} (${d.decided_by})` : '';
      return `- ${f.requirement} (${f.severity}): ${f.claim}${f.file ? ` (${f.file}:${f.line ?? '?'})` : ''}${ans}`;
    })].join('\n');
}

// baseMoved: requirements this bet changes or removes whose text on the base branch is no longer what
// the bet started from (another bet changed them meanwhile): merging the branch will need them reconciled.
function baseMoved(root, slug, base, merged) {
  const shown = git(['-C', root, 'show', `${base}:.bridgie/spec/requirements.md`]);
  if (!shown.ok) return [];
  const now = Object.fromEntries(sp.parseLiving(shown.out).map(r => [r.id, r]));
  const was = Object.fromEntries(sp.parseLiving(sp.ensureBase(root, slug)).map(r => [r.id, r]));
  const ids = [...merged.changed.map(c => c.id), ...merged.removed.map(x => x.id)];
  return ids.filter(id => was[id] && JSON.stringify(now[id]?.text) !== JSON.stringify(was[id].text))
    .map(id => `${id} ${now[id] ? 'changed' : 'was removed'} on ${base} since this bet was shaped; merging bridgie/${slug} will need that section of .bridgie/spec/requirements.md reconciled`);
}
