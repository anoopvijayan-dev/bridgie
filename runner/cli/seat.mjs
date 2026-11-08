// runSeat: the only place an adapter is launched. Guards: fresh context from declared inputs, a
// project-wide seat lock, a full state manifest before/after (P1), output schema validation, cost.
// runSwarm: one fresh seat run per card, `swarm.parallel` at a time, under one lock.
import { existsSync, mkdirSync, readdirSync, writeFileSync, cpSync, copyFileSync, rmSync, renameSync, openSync, closeSync, statSync } from 'node:fs';
import { join, basename, relative } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import * as st from '../state.mjs';
import { loadSeat, assemble } from '../context.mjs';
import { snapshot, check, restore } from '../guard.mjs';
import { validate } from '../schema.mjs';
import { HOME, die, projectRoot } from './core.mjs';

const relTo = (root, p) => relative(root, p).split('\\').join('/');

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
  writeFileSync(join(lock, 'owner.json'), JSON.stringify({ seat, run_dir: relTo(root, runDir), since: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), pid: process.pid }) + '\n');
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
    try { child = spawn(cmd, args, { stdio: ['ignore', fd, fd] }); } catch (e) { closeSync(fd); res(127); return; }
    child.on('error', () => { closeSync(fd); res(127); });
    child.on('close', code => { try { closeSync(fd); } catch { /* closed */ } res(code ?? 1); });
  });
}

// runSeat(slug, seat, { task, cwd, packet, vars, exclude, lock, runsDir }) → run directory.
export async function runSeat(slug, seat, opts = {}) {
  const root = opts.root || projectRoot();
  const cwd = opts.cwd || root;
  const seatDir = join(HOME, 'seats', seat);
  if (!existsSync(join(seatDir, 'SKILL.md'))) die(`no such seat: ${seat}`);
  const name = basename(seat);
  const runs = opts.runsDir || process.env.BRIDGIE_RUNS_DIR || join(root, '.bridgie', 'runs', slug);
  const { n, dir: runDir } = nextRunDir(runs, name);
  mkdirSync(runDir, { recursive: true });
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
  const { adapter, model = 'default', effort } = route;
  if (adapter === 'none') die(`seat ${seat} has no model adapter (mechanical seats run in the verify command)`);
  const [cmd, pre] = adapterCommand(adapter);
  const mode = manifest.writes === 'worktree' ? 'write' : 'readonly';
  const output = manifest.output;
  const { raw, caps } = adapterCapabilities(adapter, seatDir, model);
  writeFileSync(join(runDir, 'adapter.json'), raw + '\n');
  if ((manifest.tools || []).includes('web') && caps.reads_web !== true) die(`seat ${name} needs web access; adapter '${adapter}' has none (route it to one that does: routing.seats.${name})`);

  // 3. lock, snapshot, launch, measure
  const locked = opts.lock !== false;
  const excludes = [relTo(root, runDir), ...(opts.exclude ? [relTo(root, opts.exclude)] : [])];
  if (locked) seatLock(root, name, runDir);
  try {
    try { snapshot(root, join(runDir, '.snapshot'), excludes); } catch (e) { die(e.message); }
    const startedAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z'), start = Date.now();
    const args = [...pre, '--seat', seatDir, '--prompt', join(runDir, 'prompt.md'), '--out', join(runDir, output), '--cwd', cwd, '--mode', mode, '--model', model, ...(effort ? ['--effort', effort] : [])];
    const rc = await launch(cmd, args, join(runDir, 'adapter.log'));
    st.costAdd(runDir, { seat: name, adapter, model, started_at: startedAt, duration_s: Math.round((Date.now() - start) / 1000), attempt: n, exit_code: rc, tokens_in: null, tokens_out: null, usd: null });

    // 4. single-writer guard (P1): any added, removed or changed state file fails the run
    const d = check(root, join(runDir, '.snapshot'), excludes);
    if (d.added.length || d.removed.length || d.changed.length) {
      const restored = restore(root, join(runDir, '.snapshot'), excludes);
      writeFileSync(join(runDir, 'VIOLATION'), `seat ${name} modified Bridgie state directly; state restored from snapshot\n${JSON.stringify(restored)}\n`);
      die(`seat ${name} wrote to Bridgie state files; run failed and state restored (see ${join(runDir, 'VIOLATION')})`);
    }
    rmSync(join(runDir, '.snapshot'), { recursive: true, force: true });   // kept only beside a VIOLATION
    if (rc !== 0) die(`adapter ${adapter} exited ${rc} for seat ${name}; see ${join(runDir, 'adapter.log')}`);
  } finally {
    if (locked) seatUnlock(root);
  }

  // 5. output contract
  const outFile = join(runDir, output);
  if (!existsSync(outFile)) die(`seat ${name} produced no ${output}`);
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
