// runSeat: the only place an adapter is launched. Guards: fresh context from declared inputs, a
// project-wide seat lock, a full state manifest before/after (P1), output schema validation, cost.
// runSwarm: one fresh seat run per card, `swarm.parallel` at a time, under one lock.
import { readFileSync, existsSync, mkdirSync, readdirSync, writeFileSync, cpSync, copyFileSync, rmSync, renameSync, openSync, closeSync, statSync, realpathSync } from 'node:fs';
import { join, basename, relative } from 'node:path';
import { hostname } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import * as st from '../state.mjs';
import { loadSeat, assemble } from '../context.mjs';
import { snapshot, check, restore } from '../guard.mjs';
import { validate } from '../schema.mjs';
import { HOME, die, projectRoot } from './core.mjs';

// relTo: path relative to the project root with forward slashes. Both sides are resolved through
// symlinks first (macOS /var → /private/var), or a run folder looks like it lives outside the project.
const real = p => { try { return realpathSync.native(p); } catch { return p; } };
const relTo = (root, p) => relative(real(root), real(p)).split('\\').join('/');

// adapterCommand: how to launch an adapter — run.mjs with this node, or a legacy run.sh with bash.
export function adapterCommand(adapter) {
  const dir = join(HOME, 'adapters', adapter);
  if (existsSync(join(dir, 'run.mjs'))) return [process.execPath, [join(dir, 'run.mjs')]];
  if (existsSync(join(dir, 'run.sh'))) return ['bash', [join(dir, 'run.sh')]];
  die(`adapter not found: ${dir} (needs run.mjs)`);
}

export function adapterCapabilities(adapter, seatDir, model = 'default') {
  const [cmd, pre] = adapterCommand(adapter);
  const r = spawnSync(cmd, [...pre, '--capabilities', '--seat', seatDir, '--model', model || 'default'], { encoding: 'utf8' });
  if (r.status !== 0) die(`adapter ${adapter}: --capabilities failed: ${(r.stderr || r.error?.message || '').trim()}`);
  const raw = r.stdout.trim();
  try { return { raw, caps: JSON.parse(raw) }; } catch { die(`adapter ${adapter}: --capabilities printed no JSON: ${raw.slice(0, 200)}`); }
}

export function seatLock(root, seat, runDir) {
  const lock = join(root, '.bridgie', '.seat-lock');
  try { mkdirSync(lock); } catch {
    const held = st.seatLock(root);
    if (held) die(`another agent run is in progress in this project (${JSON.stringify(held)}); wait for it, or delete ${lock} if none is running`);
    rmSync(lock, { recursive: true, force: true });
    try { mkdirSync(lock); } catch (e) { die(`could not take the seat lock ${lock}: ${e.message}`); }
  }
  writeFileSync(join(lock, 'owner.json'), JSON.stringify({ seat, run_dir: relTo(root, runDir), since: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), pid: process.pid, host: hostname() }) + '\n');
}
export const seatUnlock = root => rmSync(join(root, '.bridgie', '.seat-lock'), { recursive: true, force: true });

function nextRunDir(runs, name) {
  mkdirSync(runs, { recursive: true });
  const n = readdirSync(runs).filter(d => d.startsWith(`${name}-`) && statSync(join(runs, d)).isDirectory()).length + 1;
  return { n, dir: join(runs, `${name}-${String(n).padStart(2, '0')}`) };
}

function launch(cmd, args, logFile) {
  return new Promise(res => {
    const fd = openSync(logFile, 'w');
    let child;
    try { child = spawn(cmd, args, { stdio: ['ignore', fd, fd], env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } }); } catch (e) { closeSync(fd); res(127); return; }
    child.on('error', () => { closeSync(fd); res(127); });
    child.on('close', code => { try { closeSync(fd); } catch { /* closed */ } res(code ?? 1); });
  });
}

// runSeat(slug, seat, { task, cwd, packet, vars, exclude, lock, runsDir, onRunDir, snapshot, onViolation }) → run directory.
export async function runSeat(slug, seat, opts = {}) {
  const root = opts.root || projectRoot();
  const cwd = opts.cwd || root;
  const seatDir = join(HOME, 'seats', seat);
  if (!existsSync(join(seatDir, 'SKILL.md'))) die(`no such seat: ${seat}`);
  const name = basename(seat);
  const runs = opts.runsDir || process.env.BRIDGIE_RUNS_DIR || join(root, '.bridgie', 'runs', slug);
  const { n, dir: runDir } = nextRunDir(runs, name);
  mkdirSync(runDir, { recursive: true });
  opts.onRunDir?.(runDir);   // a batch of seats running together registers each run folder as it appears
  if (opts.packet && existsSync(opts.packet)) cpSync(opts.packet, runDir, { recursive: true });
  if (opts.vars) copyFileSync(opts.vars, join(runDir, 'vars.json'));

  // 1. fresh context from declared inputs only
  let ctx;
  try { ctx = assemble(root, slug, seat, { runDir, cwd, task: opts.task }); }
  catch (e) { die(`context assembly failed for ${seat}: ${e.message}`); }
  writeFileSync(join(runDir, 'prompt.md'), ctx.prompt);
  writeFileSync(join(runDir, 'inputs.json'), JSON.stringify({ inputs: ctx.inputs, missing: ctx.missing }, null, 2) + '\n');
  writeFileSync(join(runDir, 'context.json'), JSON.stringify({ prompt_file: join(runDir, 'prompt.md'), inputs: ctx.inputs, missing: ctx.missing }) + '\n');

  // 2. routing and adapter
  const { manifest } = loadSeat(seat);
  let route;
  try { route = st.route(root, manifest); } catch (e) { die(`routing failed: ${e.message}`); }
  if (route.adapter === 'none') die(`seat ${seat} has no model adapter (mechanical seats run in the verify command)`);
  const mode = manifest.writes === 'worktree' ? 'write' : 'readonly';
  const output = manifest.output;
  const needsWeb = (manifest.tools || []).includes('web');
  // fits: can this adapter take the seat? (web for research; repo access and another model family
  // for the reviewer, when the caller says so)
  const fits = caps => (!needsWeb || caps.reads_web === true) && (!opts.needsRepo || caps.reads_repo === true) && (!opts.avoidVendor || caps.vendor !== opts.avoidVendor);
  let { adapter, model = 'default', effort } = route;
  let { raw, caps } = adapterCapabilities(adapter, seatDir, model);
  if (needsWeb && caps.reads_web !== true) die(`seat ${name} needs web access; adapter '${adapter}' has none (route it to one that does: routing.seats.${name})`);
  const spare = st.fallbacks(root, adapter);
  const exhausted = [];   // adapters skipped or failed because they are at a usage limit
  // waiting: every adapter that could take the seat is at its usage limit. Not an error and not a
  // verdict: exit 3, naming when to come back, so `bridgie run` stops cleanly and nothing is consumed.
  const waiting = () => {
    const until = exhausted.map(a => st.exhaustedUntil(root, a)).filter(Boolean).sort()[0];
    die(`waiting: ${exhausted.join(' and ')} ${exhausted.length > 1 ? 'are' : 'is'} at ${exhausted.length > 1 ? 'their' : 'its'} usage limit${until ? ` until ${until.replace(/\.\d+Z$/, 'Z')}` : ''}, and no other adapter fits seat ${name}${opts.avoidVendor ? ` (policy requires another model family than ${opts.avoidVendor})` : ''}. Nothing was changed; run it again after that`, 3);
  };
  // nextFallback: the next spare adapter whose CLI is installed and that fits the seat.
  const nextFallback = () => {
    while (spare.length) {
      const a = spare.shift();
      if (!existsSync(join(HOME, 'adapters', a))) continue;
      if (st.exhaustedUntil(root, a)) { exhausted.push(a); continue; }   // at its usage limit: not tried again until it resets
      const [c, p] = adapterCommand(a);
      const probe = spawnSync(c, [...p, '--probe'], { encoding: 'utf8', timeout: 30000 });
      if (probe.status !== 0 || !/OK/.test(probe.stdout || '')) continue;
      const got = adapterCapabilities(a, seatDir, 'default');
      if (fits(got.caps)) return { adapter: a, ...got };
    }
    return null;
  };

  // 3. lock, snapshot, launch, measure; on an adapter that cannot run at all, warn and fall back
  const locked = opts.lock !== false;
  // What the state guard ignores for this run: its own run folder, plus what the caller names. A
  // function is asked again at every check, so seats running side by side ignore one another's run
  // folders (and nothing else) however late those appear.
  const excludes = () => [runDir, ...(typeof opts.exclude === 'function' ? opts.exclude() : opts.exclude ? [opts.exclude] : [])].map(x => relTo(root, x));
  if (locked) seatLock(root, name, runDir);
  try {
    // Seats running side by side share one snapshot, taken before any of them started (opts.snapshot):
    // a snapshot of its own could already hold what a sibling wrote.
    const snap = opts.snapshot || join(runDir, '.snapshot');
    if (!opts.snapshot) { try { snapshot(root, snap, excludes()); } catch (e) { die(e.message); } }
    const fellBack = [];
    if (st.exhaustedUntil(root, adapter)) {   // known to be at its limit: do not launch it to find out again
      exhausted.push(adapter);
      const next = nextFallback();
      if (!next) waiting();
      process.stderr.write(`bridgie: warning: adapter ${adapter} is at its usage limit until ${st.exhaustedUntil(root, adapter)}; using ${next.adapter} for seat ${name}\n`);
      fellBack.push(adapter);
      writeFileSync(join(runDir, 'fallback.json'), JSON.stringify({ routed: route.adapter, failed: fellBack, used: next.adapter }, null, 2) + '\n');
      ({ adapter, raw, caps } = next); model = 'default'; effort = null;
    }
    for (;;) {
      writeFileSync(join(runDir, 'adapter.json'), raw + '\n');
      const [cmd, pre] = adapterCommand(adapter);
      const startedAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z'), start = Date.now();
      const args = [...pre, '--seat', seatDir, '--prompt', join(runDir, 'prompt.md'), '--out', join(runDir, output), '--cwd', cwd, '--mode', mode, '--model', model, ...(effort ? ['--effort', effort] : [])];
      const rc = await launch(cmd, args, join(runDir, 'adapter.log'));
      st.costAdd(runDir, { seat: name, ...(opts.task ? { task: opts.task } : {}), adapter, model, started_at: startedAt, duration_s: Math.round((Date.now() - start) / 1000), attempt: n, exit_code: rc, tokens_in: null, tokens_out: null, usd: null });

      // 4. single-writer guard (P1): any added, removed or changed state file fails the run
      const d = check(root, snap, excludes());
      if (d.added.length || d.removed.length || d.changed.length) {
        const restored = restore(root, snap, excludes());
        const who = opts.snapshot ? `Bridgie state was modified while seat ${name} ran beside other seats (by this seat or one of them)` : `seat ${name} modified Bridgie state directly`;
        writeFileSync(join(runDir, 'VIOLATION'), `${who}; state restored from snapshot\n${JSON.stringify(restored)}\n`);
        opts.onViolation?.(runDir);
        die(`seat ${name} wrote to Bridgie state files; run failed and state restored (see ${join(runDir, 'VIOLATION')})`);
      }
      if (rc === 0) break;
      let why = '';
      try { why = readFileSync(join(runDir, 'adapter.log'), 'utf8').trim().split(/\r?\n/).filter(l => /^(adapter|extract-json):|not found|no Antigravity project/.test(l)).pop() || ''; } catch {}
      const failed = `adapter ${adapter} exited ${rc} for seat ${name}${why ? `: ${why}` : ''}`;
      // 1: the adapter could not start (CLI missing, not set up); 6: the CLI failed (signed out, over
      // its limit, crashed); 127: could not launch. A model that ran but answered badly (4, 5) is not
      // a reason to switch models.
      // A CLI at its usage limit says so in its log: remember it (with the reset time when the log
      // gives one), so nothing launches it again before then.
      const quota = [1, 6].includes(rc) ? st.quotaFromRun(runDir, start - 2000) : null;
      if (quota) { st.markExhausted(root, adapter, quota.until, quota.why); exhausted.push(adapter); }
      const next = [1, 6, 127].includes(rc) ? nextFallback() : null;
      if (!next && quota) waiting();
      if (!next) die(`${failed}; see ${join(runDir, 'adapter.log')}${fellBack.length ? ` (after falling back from ${fellBack.join(', ')})` : ''}`);
      process.stderr.write(`bridgie: warning: ${failed}; falling back to ${next.adapter}\n`);
      renameSync(join(runDir, 'adapter.log'), join(runDir, `adapter-${adapter}.log`));
      for (const f of [output, 'reply.txt']) rmSync(join(runDir, f), { force: true });
      fellBack.push(adapter);
      writeFileSync(join(runDir, 'fallback.json'), JSON.stringify({ routed: route.adapter, failed: fellBack, used: next.adapter }, null, 2) + '\n');
      ({ adapter, raw, caps } = next); model = 'default'; effort = null;
    }
    if (!opts.snapshot) rmSync(snap, { recursive: true, force: true });   // kept only beside a VIOLATION
  } finally {
    if (locked) seatUnlock(root);
  }

  // 5. output contract
  const outFile = join(runDir, output);
  if (!existsSync(outFile)) die(`seat ${name} produced no ${output}`);
  // A review's task and verifier are facts the runner knows (which task, which CLI and model ran);
  // the runner records them rather than trusting the model to report on itself.
  if (output === 'evidence.json') {
    try {
      const ev = st.readJson(outFile);
      if (ev && typeof ev === 'object' && !Array.isArray(ev)) {
        if (opts.task) ev.task = opts.task;
        ev.verifier = { seat: name, adapter, model };
        writeFileSync(outFile, JSON.stringify(ev, null, 2) + '\n');
      }
    } catch { /* unreadable: the schema check below reports it */ }
  }
  let errs;
  try { errs = validate(st.loadSchema(output.replace(/\.json$/, '')), st.readJson(outFile)); } catch (e) { errs = [e.message]; }
  if (errs.length) die(`seat ${name} output does not match schemas/${output}: ${errs.slice(0, 5).join('; ')}`);
  return runDir;
}

// runSwarm(slug, seat, cardsFile, dir) → { ok, failed }. Members are retried once; failures are left out.
export async function runSwarm(slug, seat, cardsFile, dir, { root = projectRoot() } = {}) {
  const parallel = Math.max(1, Number(st.loadPolicy(root).swarm?.parallel) || 4);
  const { cards } = st.readJson(cardsFile);
  mkdirSync(join(dir, 'cards'), { recursive: true });
  for (const c of cards) writeFileSync(join(dir, 'cards', `${c.id}.json`), JSON.stringify(c, null, 2));
  seatLock(root, `${basename(seat)}-swarm`, dir);
  let ok = 0, failed = 0;
  const member = async id => {
    for (let attempt = 1; attempt <= 2; attempt++) {
      rmSync(join(dir, id), { recursive: true, force: true });
      const runsDir = join(dir, `.runs-${id}`);
      try {
        const out = await runSeat(slug, seat, { root, runsDir, vars: join(dir, 'cards', `${id}.json`), exclude: dir, lock: false });
        renameSync(out, join(dir, id));
        rmSync(runsDir, { recursive: true, force: true });
        return true;
      } catch (e) {
        writeFileSync(join(dir, 'cards', `${id}.log`), `${e.message}\n`);
        rmSync(runsDir, { recursive: true, force: true });
      }
    }
    return false;
  };
  try {
    const queue = cards.map(c => c.id);
    const workers = Array.from({ length: Math.min(parallel, queue.length) }, async () => {
      while (queue.length) { const id = queue.shift(); if (await member(id)) ok++; else failed++; }
    });
    await Promise.all(workers);
  } finally { seatUnlock(root); }
  return { ok, failed };
}
