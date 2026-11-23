// bridgie eval reviewer [--adapter A] [--cases a,b] [--set DIR] [--parallel N] [--keep]
// Runs the real reviewer seat over changes with a known planted bug, and over clean changes, and
// reports how many bugs it caught and how many clean changes it failed. Each case is set up as a
// throwaway Bridgie project, so the reviewer gets exactly what `bridgie verify` gives it: the
// task, the requirements, the diff, the producer's claim, the runner-run test results, and
// read-only access to the repository.
import { cpSync, existsSync, mkdirSync, mkdtempSync, openSync, closeSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as st from '../state.mjs';
import * as g from '../cli/git.mjs';
import * as ev from '../evals.mjs';
import { runSeat, adapterCapabilities } from '../cli/seat.mjs';
import { loadSeat } from '../context.mjs';
import { BridgieExit, die, git, log, parseArgs } from '../cli/core.mjs';
import { costTotals, entryTokens, tokensText } from '../flow.mjs';

const SLUG = 'eval', TASK = 'T1';
const dur = s => (s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${s}s`);

// setUp: a throwaway project holding the case as a task that is built and waiting for review.
function setUp(c) {
  const root = mkdtempSync(join(tmpdir(), `bridgie-eval-${c.name}-`));
  const sh = (...a) => { const r = git(['-C', root, ...a]); if (!r.ok) throw new Error(`git ${a.join(' ')}: ${r.err || r.out}`); return r.out; };
  sh('init', '-q', '-b', 'main'); sh('config', 'user.email', 'eval@example.invalid'); sh('config', 'user.name', 'bridgie eval'); sh('config', 'commit.gpgsign', 'false');
  cpSync(join(c.dir, 'base'), root, { recursive: true });
  sh('add', '-A'); sh('commit', '-q', '-m', 'base');
  for (const d of ['bets', 'specs', 'runs', 'acceptance', 'decisions', 'learn']) mkdirSync(join(root, '.bridgie', d), { recursive: true });
  writeFileSync(join(root, '.bridgie', 'policy.yaml'), 'version: 1\n');
  st.betNew(root, SLUG, { title: c.title, lane: 'engineering', risk: 'none', owner: 'eval' });
  mkdirSync(join(root, '.bridgie', 'specs', SLUG), { recursive: true });
  writeFileSync(join(root, '.bridgie', 'specs', SLUG, 'requirements.md'), `# Requirements — ${c.title}\n\n${c.requirements}`);
  g.featureStart(root, SLUG);
  st.writeJsonAtomic(st.tasksPath(root, SLUG), { bet: SLUG, tasks: [{ id: TASK, title: c.title, requirements: c.task_requirements, depends_on: [], status: 'verify', attempts: 1, max_attempts: 3, branch: g.taskBranch(SLUG, TASK), evidence: null, escalation: null }] }, 'tasks');
  const wt = g.taskWorktree(root, SLUG, TASK);
  cpSync(join(c.dir, 'change'), wt, { recursive: true });
  g.commitAll(wt, `bridgie: ${TASK} implementer`);
  // the producer's claim, where the reviewer's "claim" input looks for it
  const impl = join(root, '.bridgie', 'runs', SLUG, 'implementer-01'); mkdirSync(impl, { recursive: true });
  writeFileSync(join(impl, 'claim.json'), JSON.stringify({ task: TASK, claims: [{ text: c.claim, proof_cmd: c.test, proof_output: 'all tests pass' }], files_changed: c.change, notes: '' }, null, 2) + '\n');
  return { root, wt };
}

// runTests: the case's own tests, run for real in the task worktree, as verify's tiers would be.
function runTests(c, wt, packet) {
  const cmd = c.test.replace(/^python /, process.platform === 'win32' ? 'python ' : 'python3 ');
  const logf = join(packet, 'specified-1.log'), fd = openSync(logf, 'w');
  const r = spawnSync(cmd, { cwd: wt, shell: true, stdio: ['ignore', fd, fd], env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  closeSync(fd);
  const rows = [{ id: 'specified:1', tier: 'specified', check: cmd, result: r.status === 0 ? 'pass' : 'fail', artifact: logf }];
  writeFileSync(join(packet, 'mechanical.json'), JSON.stringify(rows) + '\n');
  return { ok: r.status === 0, cmd };
}

async function runCase(c, keep) {
  const started = Date.now();
  let root;
  try {
    const made = setUp(c); root = made.root;
    const packet = mkdtempSync(join(tmpdir(), 'bridgie-eval-packet-'));
    let rvDir;
    try {
      g.diffPacket(root, SLUG, TASK, packet);
      const t = runTests(c, made.wt, packet);
      if (!t.ok) return { name: c.name, planted: c.planted.length > 0, result: 'skipped', why: `its own tests do not pass on this machine (${t.cmd})` };
      const rv = g.reviewWorktree(root, SLUG, TASK);
      try { rvDir = await runSeat(SLUG, 'verify/reviewer', { root, task: TASK, cwd: rv, packet, needsRepo: true }); }
      finally { g.removeWorktree(root, rv); }
    } finally { rmSync(packet, { recursive: true, force: true }); }
    const evidence = st.readJson(join(rvDir, 'evidence.json'));
    const cost = st.readJson(join(rvDir, 'cost.json')).entries.at(-1);
    return { ...ev.scoreCase(c, evidence), seconds: Math.round((Date.now() - started) / 1000), tokens: entryTokens(cost), usd: typeof cost.usd === 'number' ? cost.usd : null, adapter: evidence.verifier?.adapter, ...(keep ? { kept: root } : {}) };
  } catch (e) {
    if (e instanceof BridgieExit && e.code === 3) throw e;                      // a usage limit: stop the whole eval
    return { name: c.name, planted: c.planted.length > 0, result: 'error', why: String(e.message || e).split('\n')[0] };
  } finally { if (root && !keep) rmSync(root, { recursive: true, force: true }); }
}

export function table(results) {
  const head = ['Case', 'Planted', 'Result', 'Verdict', 'Serious findings', 'Time'];
  const body = results.map(r => [r.name, r.planted ? 'bug' : 'clean', r.result, r.verdict || '-', r.serious ?? '-', r.seconds !== undefined ? dur(r.seconds) : '-'].map(String));
  const w = head.map((h, i) => Math.max(h.length, ...body.map(b => b[i].length)));
  return [head, ...body].map(cells => cells.map((x, i) => x.padEnd(w[i])).join('  ').trimEnd()).join('\n');
}

export default async function evalCmd(argv) {
  const a = parseArgs(argv, { adapter: 'value', cases: 'value', set: 'value', parallel: 'value', keep: 'bool' }, 'eval');
  if (a._[0] !== 'reviewer') die('usage: bridgie eval reviewer [--adapter A] [--cases a,b] [--set DIR] [--parallel N] [--keep]');
  if (a.adapter) process.env.BRIDGIE_ADAPTER = a.adapter;
  const n = a.parallel !== undefined ? Number(a.parallel) : 3;
  if (!Number.isInteger(n) || n < 1 || n > 8) die('eval: --parallel takes a whole number from 1 to 8');
  let cases;
  try { cases = ev.loadCases(a.set || ev.CASES_DIR, a.cases ? a.cases.split(',').map(s => s.trim()).filter(Boolean) : null); } catch (e) { die(`eval: ${e.message}`); }
  if (!cases.length) die('eval: no cases to run');

  // which reviewer this is: the adapter the reviewer seat routes to here (or --adapter)
  const scratch = mkdtempSync(join(tmpdir(), 'bridgie-eval-route-')); mkdirSync(join(scratch, '.bridgie'), { recursive: true }); writeFileSync(join(scratch, '.bridgie', 'policy.yaml'), 'version: 1\n');
  let route, caps;
  try { route = st.route(scratch, loadSeat('verify/reviewer').manifest); caps = adapterCapabilities(route.adapter, join(st.HOME, 'seats', 'verify', 'reviewer'), route.model).caps; }
  finally { rmSync(scratch, { recursive: true, force: true }); }
  if (caps.reads_repo !== true) die(`eval: adapter '${route.adapter}' cannot read a repository, so it cannot be a reviewer`);
  log(`testing reviewer ${route.adapter}${route.model && route.model !== 'default' ? ` (${route.model})` : ''} on ${cases.length} case(s): ${cases.filter(c => c.planted.length).length} with a planted bug, ${cases.filter(c => !c.planted.length).length} clean; ${n} at a time`);

  const results = new Array(cases.length);
  let next = 0, waiting = null;
  await Promise.all(Array.from({ length: Math.min(n, cases.length) }, async () => {
    while (next < cases.length && !waiting) {
      const i = next++;
      try { results[i] = await runCase(cases[i], a.keep); log(`  ${cases[i].name}: ${results[i].result}${results[i].why ? ` (${results[i].why})` : ''}`); }
      catch (e) { waiting = e; }
    }
  }));
  const done = results.filter(Boolean);
  const summary = ev.summarise(done);
  process.stdout.write(`${table(done)}\n\n`);
  const tot = { tokens: done.some(r => typeof r.tokens === 'number') ? done.reduce((s, r) => s + (r.tokens || 0), 0) : null, usd: done.some(r => typeof r.usd === 'number') ? done.reduce((s, r) => s + (r.usd || 0), 0) : null };
  const spent = `${tot.tokens !== null ? `; ${tokensText(tot.tokens)} tokens` : ''}${tot.usd !== null ? `; $${tot.usd.toFixed(2)} at list price` : ''}`;
  process.stdout.write(`${route.adapter} (${caps.vendor}): ${ev.summaryText(summary)}${summary.skipped ? `; ${summary.skipped} skipped` : ''}${summary.errors ? `; ${summary.errors} could not be run` : ''}${spent}\n`);
  for (const r of done.filter(x => x.result === 'missed')) process.stdout.write(`  missed ${r.name}${r.verdict === 'pass' ? ': passed the change' : `: verdict ${r.verdict}, for other reasons`}\n`);
  for (const r of done.filter(x => x.result === 'false alarm')) process.stdout.write(`  false alarm ${r.name}: ${r.findings[0]?.claim || `verdict ${r.verdict} with no serious finding`}\n`);
  for (const r of done.filter(x => x.kept)) process.stdout.write(`  kept ${r.name}: ${r.kept}\n`);
  if (summary.ran) {
    const f = ev.saveRun({ adapter: route.adapter, model: route.model || 'default', vendor: caps.vendor, at: st.now(), set: a.set ? 'custom' : 'builtin', complete: !waiting && done.length === cases.length && !summary.skipped && !summary.errors, summary, tokens: tot.tokens, usd: tot.usd,
      cases: done.map(({ kept, ...r }) => r) });
    log(`saved to ${f}`);
  }
  if (summary.planted >= 5 && summary.caught === summary.planted && !summary.false_alarms) log('note: a perfect score means these cases no longer separate this reviewer from a better one, not that it misses nothing; add harder cases of your own with --set');
  if (summary.planted && summary.planted < 5) log('note: fewer than five planted bugs were tested; treat the rate as a rough guide');
  if (waiting) die(`${waiting.message}\neval: stopped early; ${done.length} of ${cases.length} case(s) were run`, 3);
  if (!summary.ran) die('eval: no case could be run (see the reasons above)');
}
